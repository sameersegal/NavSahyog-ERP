import { Hono, type Context } from 'hono';
import { requireAuth } from '../auth';
import { requireCap, capabilitiesFor } from '../policy';
import { villageIdsInScope } from '../scope';
import { isIsoDate, todayIstDate } from '../lib/time';
import { err } from '../lib/errors';
import { csvFilename, toCsv, type CsvCell } from '../lib/csv';
import {
  breadcrumbFor,
  childLevelOf,
  effectiveVillages,
  GEO_JOIN,
  GEO_LEVELS,
  isGeoLevel,
  LEVEL_ALIAS,
  villagesUnder,
  type GeoLevel,
  type NonRootLevel,
} from '../lib/geo';
import {
  DASHBOARD_METRICS,
  isDashboardMetric as isMetric,
  type BreadcrumbCrumb as Crumb,
  type DashboardMetric as Metric,
} from '@navsahyog/shared';
import type { Bindings, SessionUser, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

type DrillResult = {
  metric: Metric;
  level: GeoLevel;
  id: number | null;
  crumbs: Crumb[];
  child_level: GeoLevel | 'detail' | null;
  headers: string[];
  rows: CsvCell[][];
  // Same length as rows. For aggregate views, each entry is the id
  // to drill into at `child_level`; for leaf (detail) views, null.
  drill_ids: (number | null)[];
  // Period covered by attendance / achievements metrics. `null` for
  // metrics that are period-independent (children, vc, af).
  period: { from: string; to: string } | null;
  // L2.5.3 (§3.6.2) — consolidated KPI pack + attendance trend at
  // the current scope. Omitted unless the request sets
  // `consolidated=1`. Same page, same edge-cache key; one request
  // serves both the metric-specific table and the always-on strip.
  consolidated?: ConsolidatedPayload | null;
};

// L2.5.3 consolidated payload. KPIs share the drill-down's
// `from`/`to` window. SoM counters are calendar-month scoped
// (current vs previous full month) independent of the period
// filter — the §3.6.2 spec treats SoM as a monthly cadence.
export type ConsolidatedPayload = {
  kpis: {
    attendance_pct: number | null;
    avg_children: number | null;
    image_pct: number | null;
    video_pct: number | null;
    som_current: number;
    som_delta: number | null;
  };
  // 6-month trend at non-village scopes, rolling back from the
  // calendar month of `to`. Absent at village leaf (that view is
  // per-session detail, not aggregate).
  chart: {
    bars: Array<{ month: string; pct: number | null }>;
  };
};

// Walked by scripts/gen-matrix.mjs. Dashboards are online-only by
// design (offline-scope.md §3.6) — the cached snapshot is not kept.
export const meta: RouteMeta = {
  context: 'dashboard',
  resource: 'dashboard',
  cra: 'read-only',
  offline: { read: 'online-only' },
  refs: ['§3.6'],
};

const dashboard = new Hono<{ Bindings: Bindings; Variables: Variables }>();

dashboard.use('*', requireAuth);

// ---- helpers ------------------------------------------------------

// First-of-month IST, as 'YYYY-MM-DD'. Default lower bound for
// attendance / achievements metrics so the dashboard lands on the
// current period without requiring a date picker. `todayIstDate()`
// gives us 'YYYY-MM-DD' in IST; we just clamp the day to 01.
function firstOfMonthIst(): string {
  return todayIstDate().slice(0, 7) + '-01';
}

// Aggregate one metric at the child level below `(level, id)`,
// filtered to `villageIds`.
//
// For metrics that aggregate people-in-the-system (children, vc, af),
// the period is ignored. For metrics that aggregate time-bound events
// (attendance, achievements), `from`/`to` scope the period.
async function aggregateForChildren(
  db: D1Database,
  villageIds: number[],
  childLevel: NonRootLevel,
): Promise<{ id: number; name: string; value: number }[]> {
  if (villageIds.length === 0) return [];
  const alias = LEVEL_ALIAS[childLevel];
  const placeholders = villageIds.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT ${alias}.id AS id, ${alias}.name AS name,
              COUNT(DISTINCT CASE WHEN s.graduated_at IS NULL THEN s.id END) AS value
       ${GEO_JOIN}
       LEFT JOIN student s ON s.village_id = v.id
       WHERE v.id IN (${placeholders})
       GROUP BY ${alias}.id, ${alias}.name
       ORDER BY ${alias}.name`,
    )
    .bind(...villageIds)
    .all<{ id: number; name: string; value: number }>();
  return rs.results;
}

async function aggregateForVc(
  db: D1Database,
  villageIds: number[],
  childLevel: NonRootLevel,
): Promise<{ id: number; name: string; value: number }[]> {
  if (villageIds.length === 0) return [];
  const alias = LEVEL_ALIAS[childLevel];
  const placeholders = villageIds.map(() => '?').join(',');
  // A VC is scoped to a village (scope_level='village', scope_id=village.id).
  // We roll up the VC count at whatever child level is asked for.
  const rs = await db
    .prepare(
      `SELECT ${alias}.id AS id, ${alias}.name AS name,
              COUNT(DISTINCT u.id) AS value
       ${GEO_JOIN}
       LEFT JOIN user u ON u.role = 'vc' AND u.scope_level = 'village' AND u.scope_id = v.id
       WHERE v.id IN (${placeholders})
       GROUP BY ${alias}.id, ${alias}.name
       ORDER BY ${alias}.name`,
    )
    .bind(...villageIds)
    .all<{ id: number; name: string; value: number }>();
  return rs.results;
}

async function aggregateForAf(
  db: D1Database,
  villageIds: number[],
  childLevel: NonRootLevel,
): Promise<{ id: number; name: string; value: number }[]> {
  if (villageIds.length === 0) return [];
  const alias = LEVEL_ALIAS[childLevel];
  const placeholders = villageIds.map(() => '?').join(',');
  // AFs are cluster-scoped. COUNT(DISTINCT u.id) folded over all
  // villages under each child group — an AF covering multiple
  // clusters (future) wouldn't be double-counted within a single
  // child row.
  const rs = await db
    .prepare(
      `SELECT ${alias}.id AS id, ${alias}.name AS name,
              COUNT(DISTINCT u.id) AS value
       ${GEO_JOIN}
       LEFT JOIN user u ON u.role = 'af' AND u.scope_level = 'cluster' AND u.scope_id = c.id
       WHERE v.id IN (${placeholders})
       GROUP BY ${alias}.id, ${alias}.name
       ORDER BY ${alias}.name`,
    )
    .bind(...villageIds)
    .all<{ id: number; name: string; value: number }>();
  return rs.results;
}

async function aggregateForAttendance(
  db: D1Database,
  villageIds: number[],
  childLevel: NonRootLevel,
  from: string,
  to: string,
): Promise<{ id: number; name: string; value: number; extra: string }[]> {
  if (villageIds.length === 0) return [];
  const alias = LEVEL_ALIAS[childLevel];
  const placeholders = villageIds.map(() => '?').join(',');
  // Attendance % for the period: present distinct-student-days over
  // total distinct-student-days marked. Matches the L2.2 convention
  // (a student present in any session that day counts once).
  const rs = await db
    .prepare(
      `SELECT ${alias}.id AS id, ${alias}.name AS name,
              COUNT(DISTINCT CASE WHEN m.present = 1 THEN sess.date || '|' || m.student_id END) AS present_days,
              COUNT(DISTINCT sess.date || '|' || m.student_id) AS marked_days
       ${GEO_JOIN}
       LEFT JOIN attendance_session sess ON sess.village_id = v.id AND sess.date BETWEEN ? AND ?
       LEFT JOIN attendance_mark m ON m.session_id = sess.id
       WHERE v.id IN (${placeholders})
       GROUP BY ${alias}.id, ${alias}.name
       ORDER BY ${alias}.name`,
    )
    .bind(from, to, ...villageIds)
    .all<{ id: number; name: string; present_days: number; marked_days: number }>();
  return rs.results.map((r) => ({
    id: r.id,
    name: r.name,
    value: r.marked_days === 0 ? 0 : Math.round((r.present_days / r.marked_days) * 100),
    extra: `${r.present_days}/${r.marked_days}`,
  }));
}

async function aggregateForAchievements(
  db: D1Database,
  villageIds: number[],
  childLevel: NonRootLevel,
  from: string,
  to: string,
): Promise<{ id: number; name: string; value: number; som: number; gold: number; silver: number }[]> {
  if (villageIds.length === 0) return [];
  const alias = LEVEL_ALIAS[childLevel];
  const placeholders = villageIds.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT ${alias}.id AS id, ${alias}.name AS name,
              COUNT(a.id) AS total,
              SUM(CASE WHEN a.type = 'som'    THEN 1 ELSE 0 END) AS som,
              SUM(CASE WHEN a.type = 'gold'   THEN 1 ELSE 0 END) AS gold,
              SUM(CASE WHEN a.type = 'silver' THEN 1 ELSE 0 END) AS silver
       ${GEO_JOIN}
       LEFT JOIN student s ON s.village_id = v.id
       LEFT JOIN achievement a ON a.student_id = s.id AND a.date BETWEEN ? AND ?
       WHERE v.id IN (${placeholders})
       GROUP BY ${alias}.id, ${alias}.name
       ORDER BY ${alias}.name`,
    )
    .bind(from, to, ...villageIds)
    .all<{ id: number; name: string; total: number; som: number; gold: number; silver: number }>();
  return rs.results.map((r) => ({
    id: r.id,
    name: r.name,
    value: r.total,
    som: r.som ?? 0,
    gold: r.gold ?? 0,
    silver: r.silver ?? 0,
  }));
}

// ---- leaf (per-village detail) views ----

async function leafChildren(
  db: D1Database,
  villageId: number,
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  const rs = await db
    .prepare(
      `SELECT first_name, last_name, gender, dob, joined_at, graduated_at
       FROM student WHERE village_id = ? ORDER BY first_name, last_name`,
    )
    .bind(villageId)
    .all<{
      first_name: string; last_name: string; gender: string;
      dob: string; joined_at: string; graduated_at: string | null;
    }>();
  return {
    headers: ['First name', 'Last name', 'Gender', 'DOB', 'Joined', 'Status'],
    rows: rs.results.map((r) => [
      r.first_name,
      r.last_name,
      r.gender,
      r.dob,
      r.joined_at,
      r.graduated_at ? `graduated (${r.graduated_at})` : 'active',
    ]),
  };
}

async function leafAttendance(
  db: D1Database,
  villageId: number,
  from: string,
  to: string,
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  const rs = await db
    .prepare(
      `SELECT sess.date, sess.start_time, sess.end_time, e.name AS event_name,
              COUNT(DISTINCT CASE WHEN m.present = 1 THEN m.student_id END) AS present,
              COUNT(DISTINCT m.student_id) AS total
       FROM attendance_session sess
       LEFT JOIN event e ON e.id = sess.event_id
       LEFT JOIN attendance_mark m ON m.session_id = sess.id
       WHERE sess.village_id = ? AND sess.date BETWEEN ? AND ?
       GROUP BY sess.id
       ORDER BY sess.date DESC, sess.start_time DESC`,
    )
    .bind(villageId, from, to)
    .all<{
      date: string; start_time: string; end_time: string;
      event_name: string | null; present: number; total: number;
    }>();
  return {
    headers: ['Date', 'Start', 'End', 'Event', 'Present', 'Marked'],
    rows: rs.results.map((r) => [
      r.date,
      r.start_time,
      r.end_time,
      r.event_name ?? '',
      r.present,
      r.total,
    ]),
  };
}

async function leafAchievements(
  db: D1Database,
  villageId: number,
  from: string,
  to: string,
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  const rs = await db
    .prepare(
      `SELECT a.date, a.type, a.description, a.gold_count, a.silver_count,
              s.first_name, s.last_name
       FROM achievement a
       JOIN student s ON s.id = a.student_id
       WHERE s.village_id = ? AND a.date BETWEEN ? AND ?
       ORDER BY a.date DESC, a.id DESC`,
    )
    .bind(villageId, from, to)
    .all<{
      date: string; type: 'som' | 'gold' | 'silver'; description: string;
      gold_count: number | null; silver_count: number | null;
      first_name: string; last_name: string;
    }>();
  return {
    headers: ['Date', 'Type', 'Count', 'Student', 'Description'],
    rows: rs.results.map((r) => [
      r.date,
      r.type,
      r.type === 'gold'   ? (r.gold_count ?? 1)
      : r.type === 'silver' ? (r.silver_count ?? 1)
      : 1,
      `${r.first_name} ${r.last_name}`,
      r.description,
    ]),
  };
}

async function leafVc(
  db: D1Database,
  villageId: number,
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  const rs = await db
    .prepare(
      `SELECT user_id, full_name FROM user
       WHERE role = 'vc' AND scope_level = 'village' AND scope_id = ?
       ORDER BY full_name`,
    )
    .bind(villageId)
    .all<{ user_id: string; full_name: string }>();
  return {
    headers: ['User ID', 'Name'],
    rows: rs.results.map((r) => [r.user_id, r.full_name]),
  };
}

async function leafAf(
  db: D1Database,
  villageId: number,
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  // AFs cover a cluster; list the AFs for the cluster containing
  // this village.
  const rs = await db
    .prepare(
      `SELECT u.user_id, u.full_name, c.name AS cluster_name
       FROM user u
       JOIN village v ON v.cluster_id = u.scope_id AND v.id = ?
       JOIN cluster c ON c.id = u.scope_id
       WHERE u.role = 'af' AND u.scope_level = 'cluster'
       ORDER BY u.full_name`,
    )
    .bind(villageId)
    .all<{ user_id: string; full_name: string; cluster_name: string }>();
  return {
    headers: ['User ID', 'Name', 'Cluster'],
    rows: rs.results.map((r) => [r.user_id, r.full_name, r.cluster_name]),
  };
}

// ---- main drill-down builder --------------------------------------

function parseLevelAndId(
  levelParam: string | undefined,
  idParam: string | undefined,
): { level: GeoLevel; id: number | null } | { error: string } {
  const level = levelParam ?? 'india';
  if (!isGeoLevel(level)) return { error: 'bad level' };
  if (level === 'india') return { level: 'india', id: null };
  const id = Number(idParam);
  if (!id) return { error: 'id required for this level' };
  return { level, id };
}

// Drops crumbs at levels *above* the user's scope floor. Cosmetic;
// the scope check has already happened by the time this runs. The
// point is that a cluster_admin's drill-down shouldn't render
// "India" as the root — they've never navigated "through" India.
// Requests themselves aren't clamped: the client picks a sensible
// default (user scope floor) and a user typing the query manually
// at a level above their scope still gets scope-filtered data,
// it's just labelled with the crumbs that actually apply.
function trimCrumbsToScope(user: SessionUser, crumbs: Crumb[]): Crumb[] {
  if (user.scope_level === 'global') return crumbs;
  const scopeIdx = GEO_LEVELS.indexOf(user.scope_level as GeoLevel);
  return crumbs.filter((c) => GEO_LEVELS.indexOf(c.level) >= scopeIdx);
}

// ---- consolidated (L2.5.3, §3.6.2) --------------------------------

// Denominator for attendance_pct / image_pct / video_pct. Decisions
// D13: "per scheduled attendance session in scope × date range".
// `scheduled` in our schema = a row in attendance_session.
async function sessionsInRange(
  db: D1Database,
  villageIds: number[],
  from: string,
  to: string,
): Promise<number> {
  if (villageIds.length === 0) return 0;
  const placeholders = villageIds.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM attendance_session
        WHERE village_id IN (${placeholders})
          AND date BETWEEN ? AND ?`,
    )
    .bind(...villageIds, from, to)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Attendance % over the period — same semantics as §3.6.1's
// aggregateForAttendance cells, but collapsed to a single number
// for the whole scope. Null when there are no marks (so the UI can
// render a dash, not a misleading 0%).
async function consolidatedAttendancePct(
  db: D1Database,
  villageIds: number[],
  from: string,
  to: string,
): Promise<number | null> {
  if (villageIds.length === 0) return null;
  const placeholders = villageIds.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT SUM(CASE WHEN m.present = 1 THEN 1 ELSE 0 END) AS present,
              COUNT(*) AS total
         FROM attendance_session s
         JOIN attendance_mark m ON m.session_id = s.id
        WHERE s.village_id IN (${placeholders})
          AND s.date BETWEEN ? AND ?`,
    )
    .bind(...villageIds, from, to)
    .first<{ present: number | null; total: number | null }>();
  const total = row?.total ?? 0;
  if (total === 0) return null;
  return Math.round(((row?.present ?? 0) / total) * 100);
}

// Avg children per session = total marks / sessions. Null when
// there are no sessions (same honest-null rule as above).
async function consolidatedAvgChildren(
  db: D1Database,
  villageIds: number[],
  from: string,
  to: string,
  totalSessions: number,
): Promise<number | null> {
  if (villageIds.length === 0 || totalSessions === 0) return null;
  const placeholders = villageIds.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(m.id) AS marks
         FROM attendance_session s
         JOIN attendance_mark m ON m.session_id = s.id
        WHERE s.village_id IN (${placeholders})
          AND s.date BETWEEN ? AND ?`,
    )
    .bind(...villageIds, from, to)
    .first<{ marks: number | null }>();
  const marks = row?.marks ?? 0;
  return Math.round((marks / totalSessions) * 10) / 10;
}

// Image % / video % per D13 — "sessions with ≥ 1 image/video tagged
// to the same event / village / day, divided by scheduled sessions
// in scope × date range". Matching on (village_id, event_id, date)
// rather than session_id because media rows reference events, not
// sessions directly; multiple sessions on the same event-day share
// the same photo set in practice.
async function consolidatedMediaPct(
  db: D1Database,
  villageIds: number[],
  from: string,
  to: string,
  totalSessions: number,
  kind: 'image' | 'video',
): Promise<number | null> {
  if (villageIds.length === 0 || totalSessions === 0) return null;
  const placeholders = villageIds.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS hits
         FROM attendance_session s
        WHERE s.village_id IN (${placeholders})
          AND s.date BETWEEN ? AND ?
          AND EXISTS (
            SELECT 1 FROM media md
             WHERE md.village_id = s.village_id
               AND md.tag_event_id = s.event_id
               AND md.kind = ?
               AND md.deleted_at IS NULL
               -- IST offset on captured_at so a photo taken on
               -- IST-day N (but uploaded in the UTC 18:30-23:59
               -- window that spills into UTC-day N-1) still buckets
               -- under N. Attendance sessions (s.date) are
               -- IST-calendar, so the join needs matching calendar
               -- semantics. PR #31 review #5.
               AND date(md.captured_at, 'unixepoch', '+5 hours 30 minutes') = s.date
          )`,
    )
    .bind(...villageIds, from, to, kind)
    .first<{ hits: number | null }>();
  const hits = row?.hits ?? 0;
  return Math.round((hits / totalSessions) * 100);
}

// SoM counts for a calendar month. `monthPrefix` = 'YYYY-MM'. Joins
// achievement to student to re-apply the scope filter — achievements
// don't carry village_id directly.
async function consolidatedSomForMonth(
  db: D1Database,
  villageIds: number[],
  monthPrefix: string,
): Promise<number> {
  if (villageIds.length === 0) return 0;
  const placeholders = villageIds.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM achievement a
         JOIN student st ON st.id = a.student_id
        WHERE st.village_id IN (${placeholders})
          AND a.type = 'som'
          AND a.date LIKE ? || '%'`,
    )
    .bind(...villageIds, monthPrefix)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Rolling monthly attendance %, ending at the calendar month of
// `endIso`. Returns `months` points, oldest first. Matches the
// shape the client's AttendanceTrendInline already consumes.
async function consolidatedTrend(
  db: D1Database,
  villageIds: number[],
  endIso: string,
  months: number,
): Promise<Array<{ month: string; pct: number | null }>> {
  if (villageIds.length === 0) {
    return Array.from({ length: months }, (_, i) => ({
      month: shiftMonth(endIso.slice(0, 7), -(months - 1 - i)),
      pct: null,
    }));
  }
  const placeholders = villageIds.map(() => '?').join(',');
  // Fire the per-month queries in parallel — they're independent
  // and D1 handles concurrent reads cheaply. Previous serial loop
  // was the dominant cost in `consolidated=1` at aggregate scopes.
  return Promise.all(
    Array.from({ length: months }, (_, i) => {
      const month = shiftMonth(endIso.slice(0, 7), -(months - 1 - i));
      return db
        .prepare(
          `SELECT SUM(CASE WHEN m.present = 1 THEN 1 ELSE 0 END) AS present,
                  COUNT(m.id) AS total
             FROM attendance_session s
             LEFT JOIN attendance_mark m ON m.session_id = s.id
            WHERE s.village_id IN (${placeholders})
              AND s.date LIKE ? || '%'`,
        )
        .bind(...villageIds, month)
        .first<{ present: number | null; total: number | null }>()
        .then((row) => {
          const total = row?.total ?? 0;
          return {
            month,
            pct: total === 0 ? null : Math.round(((row?.present ?? 0) / total) * 100),
          };
        });
    }),
  );
}

// 'YYYY-MM' → 'YYYY-MM' shifted by `delta` months. Pure calendar
// arithmetic; avoids Date() drift on month-length mismatches.
function shiftMonth(yyyyMm: string, delta: number): string {
  const [y, m] = yyyyMm.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12 + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, '0')}`;
}

async function buildConsolidated(
  db: D1Database,
  villageIds: number[],
  from: string,
  to: string,
  skipChart: boolean,
): Promise<ConsolidatedPayload> {
  // `totalSessions` gates the denominator-based KPIs — the others
  // short-circuit to null when it's 0, so we resolve it once and
  // pass the value into the helpers. Everything downstream is then
  // independent and fires in parallel. Matters for §8.13 SLOs
  // as session counts grow past the lab seed.
  const totalSessions = await sessionsInRange(db, villageIds, from, to);
  const currentMonth = to.slice(0, 7);
  const prevMonth = shiftMonth(currentMonth, -1);
  const [
    attendancePct,
    avgChildren,
    imagePct,
    videoPct,
    somCurrent,
    somPrev,
    bars,
  ] = await Promise.all([
    consolidatedAttendancePct(db, villageIds, from, to),
    consolidatedAvgChildren(db, villageIds, from, to, totalSessions),
    consolidatedMediaPct(db, villageIds, from, to, totalSessions, 'image'),
    consolidatedMediaPct(db, villageIds, from, to, totalSessions, 'video'),
    consolidatedSomForMonth(db, villageIds, currentMonth),
    consolidatedSomForMonth(db, villageIds, prevMonth),
    skipChart
      ? Promise.resolve<Array<{ month: string; pct: number | null }>>([])
      : consolidatedTrend(db, villageIds, to, 6),
  ]);
  // §3.6.2 delta chip is a comparison — showing "+0" when neither
  // month produced a SoM reads as "steady" but the real story is
  // "no SoMs recorded". Collapse to null so the client renders a
  // dash instead of a misleading flat chip. Review PR #31 #4.
  const somDelta = somCurrent === 0 && somPrev === 0 ? null : somCurrent - somPrev;
  return {
    kpis: {
      attendance_pct: attendancePct,
      avg_children: avgChildren,
      image_pct: imagePct,
      video_pct: videoPct,
      som_current: somCurrent,
      som_delta: somDelta,
    },
    chart: { bars },
  };
}

function parsePeriod(
  from: string | undefined,
  to: string | undefined,
): { from: string; to: string } | { error: string } {
  const f = from ?? firstOfMonthIst();
  const t = to ?? todayIstDate();
  if (!isIsoDate(f)) return { error: 'from must be YYYY-MM-DD' };
  if (!isIsoDate(t)) return { error: 'to must be YYYY-MM-DD' };
  if (f > t) return { error: 'from must be <= to' };
  return { from: f, to: t };
}

// Success envelope for `buildDrillDown` — `effective` is the
// scope-filtered village id list already computed to produce the
// table, exposed so the consolidated branch in the request handler
// can reuse it (PR #31 review #2 — no second `effectiveVillages`
// round-trip per request).
type BuildOk = { result: DrillResult; effective: number[] };
type BuildFail = { status: 403 | 404; message: string };

async function buildDrillDown(
  db: D1Database,
  scopeVillageIds: number[],
  metric: Metric,
  level: GeoLevel,
  id: number | null,
  period: { from: string; to: string },
): Promise<BuildOk | BuildFail> {
  const effective = await effectiveVillages(db, scopeVillageIds, level, id);
  if (effective === 'out_of_scope') {
    return { status: 403, message: 'out of scope' };
  }

  const crumbs = await breadcrumbFor(db, level, id);
  // breadcrumbFor returns just [india] when (level, id) isn't found;
  // distinguish "india request" from "unknown non-india id".
  if (level !== 'india' && crumbs.length === 1) {
    return { status: 404, message: 'unknown id' };
  }

  const childLevel = childLevelOf(level);
  const needsPeriod = metric === 'attendance' || metric === 'achievements';
  const reportedPeriod = needsPeriod ? period : null;

  // Leaf (village) — per-detail rows, no further drill.
  if (childLevel === null) {
    if (id === null) {
      return { status: 404, message: 'village id required at leaf' };
    }
    const leaf = metric === 'children'     ? await leafChildren(db, id)
              : metric === 'attendance'    ? await leafAttendance(db, id, period.from, period.to)
              : metric === 'achievements'  ? await leafAchievements(db, id, period.from, period.to)
              : metric === 'vc'            ? await leafVc(db, id)
              : /* metric === 'af' */        await leafAf(db, id);
    const result: DrillResult = {
      metric,
      level,
      id,
      crumbs,
      child_level: 'detail',
      headers: leaf.headers,
      rows: leaf.rows,
      drill_ids: leaf.rows.map(() => null),
      period: reportedPeriod,
    };
    return { result, effective };
  }

  // Aggregate at child level.
  let result: DrillResult;
  switch (metric) {
    case 'children': {
      const agg = await aggregateForChildren(db, effective, childLevel);
      result = {
        metric, level, id, crumbs, child_level: childLevel,
        headers: [capLabel(childLevel), 'Children'],
        rows: agg.map((r) => [r.name, r.value]),
        drill_ids: agg.map((r) => r.id),
        period: null,
      };
      break;
    }
    case 'vc': {
      const agg = await aggregateForVc(db, effective, childLevel);
      result = {
        metric, level, id, crumbs, child_level: childLevel,
        headers: [capLabel(childLevel), 'VCs'],
        rows: agg.map((r) => [r.name, r.value]),
        drill_ids: agg.map((r) => r.id),
        period: null,
      };
      break;
    }
    case 'af': {
      const agg = await aggregateForAf(db, effective, childLevel);
      result = {
        metric, level, id, crumbs, child_level: childLevel,
        headers: [capLabel(childLevel), 'AFs'],
        rows: agg.map((r) => [r.name, r.value]),
        drill_ids: agg.map((r) => r.id),
        period: null,
      };
      break;
    }
    case 'attendance': {
      const agg = await aggregateForAttendance(db, effective, childLevel, period.from, period.to);
      result = {
        metric, level, id, crumbs, child_level: childLevel,
        headers: [capLabel(childLevel), 'Attendance %', 'Present/Marked'],
        rows: agg.map((r) => [r.name, r.value, r.extra]),
        drill_ids: agg.map((r) => r.id),
        period: reportedPeriod,
      };
      break;
    }
    case 'achievements': {
      const agg = await aggregateForAchievements(db, effective, childLevel, period.from, period.to);
      result = {
        metric, level, id, crumbs, child_level: childLevel,
        headers: [capLabel(childLevel), 'Total', 'SoM', 'Gold', 'Silver'],
        rows: agg.map((r) => [r.name, r.value, r.som, r.gold, r.silver]),
        drill_ids: agg.map((r) => r.id),
        period: reportedPeriod,
      };
      break;
    }
    default: {
      // Exhaustiveness check — if a new Metric is added to the union
      // above, the compiler flags the missing case here instead of
      // the function silently returning `undefined` at runtime.
      const _never: never = metric;
      throw new Error(`unhandled metric: ${_never as string}`);
    }
  }
  return { result, effective };
}

function capLabel(level: GeoLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

// ---- routes -------------------------------------------------------

type DashboardContext = Context<{ Bindings: Bindings; Variables: Variables }>;

async function handleDrillDownRequest(
  c: DashboardContext,
): Promise<DrillResult | Response> {
  const user = c.get('user');
  const metricParam = c.req.query('metric');
  if (!isMetric(metricParam)) {
    return err(c, 'bad_request', 400, `metric must be one of ${DASHBOARD_METRICS.join('|')}`);
  }
  const levelParsed = parseLevelAndId(c.req.query('level'), c.req.query('id'));
  if ('error' in levelParsed) return err(c, 'bad_request', 400, levelParsed.error);
  const periodParsed = parsePeriod(c.req.query('from'), c.req.query('to'));
  if ('error' in periodParsed) return err(c, 'bad_request', 400, periodParsed.error);
  // L2.5.3 — opt-in consolidated payload. Only truthy string values
  // count; `consolidated=0` reads as off. Accept `1` / `true` for
  // symmetry with the rest of the codebase.
  const consolidatedParam = c.req.query('consolidated');
  const wantConsolidated =
    consolidatedParam === '1' || consolidatedParam === 'true';

  const scope = await villageIdsInScope(c.env.DB, user);
  const buildOut = await buildDrillDown(
    c.env.DB, scope, metricParam, levelParsed.level, levelParsed.id, periodParsed,
  );
  if ('status' in buildOut) {
    return err(c,
      buildOut.status === 403 ? 'forbidden' : 'not_found',
      buildOut.status,
      buildOut.message,
    );
  }
  const { result, effective } = buildOut;
  result.crumbs = trimCrumbsToScope(user, result.crumbs);
  if (wantConsolidated) {
    // Reuse `effective` from `buildDrillDown` — computing it again
    // here would mean a second `villagesUnder` + scope intersection
    // per consolidated request (PR #31 review #2).
    // Skip chart at village leaf — per-session detail lives in the
    // table, a 6-month rollup of one village is noisy.
    const skipChart = result.child_level === 'detail';
    result.consolidated = await buildConsolidated(
      c.env.DB, effective, periodParsed.from, periodParsed.to, skipChart,
    );
  }
  return result;
}

// ---- home (§3.6.4) ------------------------------------------------

const HOME_WINDOWS = ['7d', '30d', 'mtd'] as const;
type HomeWindow = (typeof HOME_WINDOWS)[number];
function isHomeWindow(v: unknown): v is HomeWindow {
  return typeof v === 'string' && (HOME_WINDOWS as readonly string[]).includes(v);
}

type DateWindow = { from: string; to: string };

// Pure calendar-day shift on 'YYYY-MM-DD'. UTC math; IST has no DST
// so this is correct for our IST-pinned calendar dates.
function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' shifted by `monthDelta` calendar months. Day-of-month
// is clamped to the last valid day of the target month so '03-31'
// shifted -1 lands on '02-28' (or '02-29' in a leap year). Matches
// the spec rule for MTD-vs-prior-MTD when today's day exceeds the
// previous month's length.
function shiftMonthDay(iso: string, monthDelta: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const idx = y * 12 + (m - 1) + monthDelta;
  const ny = Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Resolve a Home preset to its current and prior-equivalent window.
// 7d / 30d are rolling windows; mtd compares calendar-month-to-date
// against the same dates of the prior calendar month (clamped).
function resolveHomeWindows(
  windowKey: HomeWindow,
  today: string,
): { current: DateWindow; previous: DateWindow } {
  if (windowKey === '7d') {
    const from = shiftDays(today, -6);
    const prevTo = shiftDays(from, -1);
    return {
      current: { from, to: today },
      previous: { from: shiftDays(prevTo, -6), to: prevTo },
    };
  }
  if (windowKey === '30d') {
    const from = shiftDays(today, -29);
    const prevTo = shiftDays(from, -1);
    return {
      current: { from, to: today },
      previous: { from: shiftDays(prevTo, -29), to: prevTo },
    };
  }
  // mtd
  const monthFirst = today.slice(0, 7) + '-01';
  return {
    current: { from: monthFirst, to: today },
    previous: {
      from: shiftMonthDay(monthFirst, -1),
      to: shiftMonthDay(today, -1),
    },
  };
}

type HomeScope = { level: GeoLevel; id: number | null };

// Default scope for a request that didn't pin one — every user sees
// their own scope floor on Home unless they pick deeper. Global
// (super_admin) lands on india; scope_level is otherwise a 1:1
// match with GeoLevel and carries an id.
function userScopeFloor(user: SessionUser): HomeScope {
  if (user.scope_level === 'global') return { level: 'india', id: null };
  return { level: user.scope_level as GeoLevel, id: user.scope_id };
}

// Parse `?scope=<level>:<id>`. Empty / missing falls back to the
// user's own scope floor. `india:` (or `india` alone) reads as the
// global root.
function parseHomeScope(
  scopeParam: string | undefined,
  user: SessionUser,
): HomeScope | { error: string } {
  if (!scopeParam) return userScopeFloor(user);
  const [rawLevel, rawId] = scopeParam.split(':');
  if (!rawLevel || !isGeoLevel(rawLevel)) {
    return { error: 'scope must be <level>:<id>' };
  }
  if (rawLevel === 'india') return { level: 'india', id: null };
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return { error: 'scope id invalid' };
  return { level: rawLevel, id };
}

// Health Score = equal-weighted mean of the four §3.6.2 KPIs in
// percent space. Nulls (no sessions in the period for a metric)
// are skipped — a scope with no attendance but full media coverage
// reads as the media-only score, not as zero. If every metric is
// null the score is null. The weighting itself is a deliberate
// first cut; spec §3.6.4 marks it as a worker-env-var tunable.
function computeHealthScore(
  consolidated: ConsolidatedPayload,
  villageCount: number,
): number | null {
  const values: number[] = [];
  if (consolidated.kpis.attendance_pct !== null) values.push(consolidated.kpis.attendance_pct);
  if (consolidated.kpis.image_pct !== null) values.push(consolidated.kpis.image_pct);
  if (consolidated.kpis.video_pct !== null) values.push(consolidated.kpis.video_pct);
  if (villageCount > 0) {
    // SoM ratio: share of in-scope villages with a SoM declared this
    // calendar month. Capped at 100 because a village can technically
    // declare more than one SoM per month (rare; spec discourages).
    values.push(
      Math.min(100, Math.round((consolidated.kpis.som_current / villageCount) * 100)),
    );
  }
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

type HomeMission = {
  kind: 'attendance' | 'image' | 'video' | 'som';
  current: number;
  target: number;
};

// Pick the largest gap among the four KPIs. Null KPIs are skipped:
// "no sessions in the period" is a noisy mission ("attendance is
// 0%") that we don't want to surface; Mission picks from whatever's
// measurable. Returns null if every gap is already closed — the
// happy path where there's nothing to nudge.
function pickMission(
  consolidated: ConsolidatedPayload,
  villageCount: number,
): HomeMission | null {
  const candidates: { kind: HomeMission['kind']; gap: number; current: number; target: number }[] = [];
  if (consolidated.kpis.attendance_pct !== null) {
    candidates.push({
      kind: 'attendance',
      gap: (100 - consolidated.kpis.attendance_pct) / 100,
      current: consolidated.kpis.attendance_pct,
      target: 100,
    });
  }
  if (consolidated.kpis.image_pct !== null) {
    candidates.push({
      kind: 'image',
      gap: (100 - consolidated.kpis.image_pct) / 100,
      current: consolidated.kpis.image_pct,
      target: 100,
    });
  }
  if (consolidated.kpis.video_pct !== null) {
    candidates.push({
      kind: 'video',
      gap: (100 - consolidated.kpis.video_pct) / 100,
      current: consolidated.kpis.video_pct,
      target: 100,
    });
  }
  if (villageCount > 0) {
    candidates.push({
      kind: 'som',
      gap: 1 - consolidated.kpis.som_current / villageCount,
      current: consolidated.kpis.som_current,
      target: villageCount,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.gap - a.gap);
  const top = candidates[0]!;
  if (top.gap <= 0) return null;
  return { kind: top.kind, current: top.current, target: top.target };
}

// Image / video % per direct-child group for the period. Mirrors
// `consolidatedMediaPct` (sessions-with-this-kind / total sessions)
// but rolled up at the child level via a single grouped query so
// observer Focus Areas don't pay N×3 round-trips.
async function aggregateMediaPctForChildren(
  db: D1Database,
  villageIds: number[],
  childLevel: NonRootLevel,
  from: string,
  to: string,
  kind: 'image' | 'video',
): Promise<{ id: number; sessions: number; hits: number }[]> {
  if (villageIds.length === 0) return [];
  const alias = LEVEL_ALIAS[childLevel];
  const placeholders = villageIds.map(() => '?').join(',');
  // CASE-around-EXISTS counts only sessions whose IST calendar day
  // matches a media row of `kind` tagged to the same village + event.
  // Same IST-shift on captured_at as the scope-level helper (PR #31
  // review #5) so a UTC-evening upload of an IST-day-N photo still
  // buckets under N.
  const rs = await db
    .prepare(
      `SELECT ${alias}.id AS id,
              COUNT(DISTINCT s.id) AS sessions,
              COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM media md
                 WHERE md.village_id = s.village_id
                   AND md.tag_event_id = s.event_id
                   AND md.kind = ?
                   AND md.deleted_at IS NULL
                   AND date(md.captured_at, 'unixepoch', '+5 hours 30 minutes') = s.date
              ) THEN s.id END) AS hits
       ${GEO_JOIN}
       LEFT JOIN attendance_session s
         ON s.village_id = v.id AND s.date BETWEEN ? AND ?
       WHERE v.id IN (${placeholders})
       GROUP BY ${alias}.id`,
    )
    .bind(kind, from, to, ...villageIds)
    .all<{ id: number; sessions: number; hits: number }>();
  return rs.results;
}

// SoM count + village count per direct-child group for the calendar
// month containing `to`. Village count is the SoM denominator
// per-child (share of the child's villages with a SoM declared).
async function aggregateSomForChildren(
  db: D1Database,
  villageIds: number[],
  childLevel: NonRootLevel,
  monthPrefix: string,
): Promise<{ id: number; village_count: number; som_count: number }[]> {
  if (villageIds.length === 0) return [];
  const alias = LEVEL_ALIAS[childLevel];
  const placeholders = villageIds.map(() => '?').join(',');
  const rs = await db
    .prepare(
      // `stu` not `st` because GEO_JOIN already aliases `state st`.
      `SELECT ${alias}.id AS id,
              COUNT(DISTINCT v.id) AS village_count,
              COUNT(DISTINCT a.id) AS som_count
       ${GEO_JOIN}
       LEFT JOIN student stu ON stu.village_id = v.id
       LEFT JOIN achievement a ON a.student_id = stu.id
                              AND a.type = 'som'
                              AND a.date LIKE ? || '%'
       WHERE v.id IN (${placeholders})
       GROUP BY ${alias}.id`,
    )
    .bind(monthPrefix, ...villageIds)
    .all<{ id: number; village_count: number; som_count: number }>();
  return rs.results;
}

type HomeFocusArea = {
  // Always a non-root level — Focus Areas are direct children of
  // the user's scope, and 'india' is virtual / has no parent.
  level: NonRootLevel;
  id: number;
  name: string;
  // Composite Health Score (0-100, equal-weighted mean of the four
  // measurable KPIs, nulls skipped — same formula as the scope-level
  // card, applied per child).
  health_score: number;
  // §3.6.2 KPI pack for this child. `null` means "no measurable
  // activity in this window" — the doer client uses this to suppress
  // a row, the observer client renders an em-dash so the row stays
  // legible.
  attendance_pct: number | null;
  image_pct: number | null;
  video_pct: number | null;
  som_pct: number | null;
  // The KPI with the largest gap to target. Drives the doer's
  // single-line "needs X" rendering. Null when every KPI is at
  // target.
  dominant_gap_kind: 'attendance' | 'image' | 'video' | 'som' | null;
};

// Per-child Health Score row used by `buildHomeFocusAreas`. Holds
// raw counters from the four grouped queries before the composite
// is computed; the public `HomeFocusArea` shape exposes percents
// and the dominant-gap label.
type ChildKpiRow = {
  id: number;
  name: string;
  attendance_pct: number | null;
  image_pct: number | null;
  video_pct: number | null;
  som_count: number;
  village_count: number;
};

// Compute the per-child Health Score. Same formula as the scope-
// level `computeHealthScore`: equal-weighted mean of the four KPIs
// in percent space, nulls skipped, SoM as `som_count / village_count
// × 100` capped at 100. Returns `null` when nothing's measurable
// (no attendance, no media, no villages) — caller filters those
// rows out.
function childHealthScore(row: ChildKpiRow): { score: number | null; som_pct: number | null } {
  const values: number[] = [];
  if (row.attendance_pct !== null) values.push(row.attendance_pct);
  if (row.image_pct !== null) values.push(row.image_pct);
  if (row.video_pct !== null) values.push(row.video_pct);
  const som_pct = row.village_count > 0
    ? Math.min(100, Math.round((row.som_count / row.village_count) * 100))
    : null;
  if (som_pct !== null) values.push(som_pct);
  if (values.length === 0) return { score: null, som_pct };
  return {
    score: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    som_pct,
  };
}

// Pick the KPI with the largest `(target − current) / target` gap
// for a single child. Mirrors the scope-level `pickMission` logic
// but doesn't carry current/target — only the kind label, used for
// the doer-side "needs X" copy. Null when every KPI is at or above
// target (the happy path).
function dominantGapKind(
  attendance: number | null,
  image: number | null,
  video: number | null,
  som: number | null,
): HomeFocusArea['dominant_gap_kind'] {
  const gaps: { kind: NonNullable<HomeFocusArea['dominant_gap_kind']>; gap: number }[] = [];
  if (attendance !== null) gaps.push({ kind: 'attendance', gap: (100 - attendance) / 100 });
  if (image !== null)      gaps.push({ kind: 'image',      gap: (100 - image)      / 100 });
  if (video !== null)      gaps.push({ kind: 'video',      gap: (100 - video)      / 100 });
  if (som !== null)        gaps.push({ kind: 'som',        gap: (100 - som)        / 100 });
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => b.gap - a.gap);
  const top = gaps[0]!;
  if (top.gap <= 0) return null;
  return top.kind;
}

// Top-3 direct-child scopes by Health Score ascending. Same payload
// for both branches; doer client renders the dominant-gap kind as a
// single-line "needs X" copy, observer client renders the full 4-KPI
// strip + Health Score. Children with no measurable activity at all
// are filtered out — a 0/100 row there is "no data" not "real bad",
// and surfacing those would crowd the page with empty scopes that
// need data entry rather than attention.
async function buildHomeFocusAreas(
  db: D1Database,
  villageIds: number[],
  parentLevel: GeoLevel,
  period: DateWindow,
): Promise<HomeFocusArea[]> {
  const childLevel = childLevelOf(parentLevel);
  if (!childLevel) return [];

  // 4 grouped queries fire in parallel — D1 handles concurrent reads
  // cheaply, and they're independent. Same window for all four; SoM
  // is calendar-month scoped (current month containing `period.to`)
  // to match §3.6.2's monthly cadence.
  const monthPrefix = period.to.slice(0, 7);
  const [attRows, imageRows, videoRows, somRows] = await Promise.all([
    aggregateForAttendance(db, villageIds, childLevel, period.from, period.to),
    aggregateMediaPctForChildren(db, villageIds, childLevel, period.from, period.to, 'image'),
    aggregateMediaPctForChildren(db, villageIds, childLevel, period.from, period.to, 'video'),
    aggregateSomForChildren(db, villageIds, childLevel, monthPrefix),
  ]);

  // Index image/video/som rows by child id; attendance carries the
  // canonical name + id ordering. Children without any media or SoM
  // data simply miss in the lookups and get null KPIs.
  const imageById = new Map(imageRows.map((r) => [r.id, r]));
  const videoById = new Map(videoRows.map((r) => [r.id, r]));
  const somById   = new Map(somRows.map((r) => [r.id, r]));

  const rows: ChildKpiRow[] = attRows.map((a) => {
    const marked = Number(a.extra.split('/')[1] ?? 0);
    const attendance_pct = marked > 0 ? a.value : null;
    const img = imageById.get(a.id);
    const vid = videoById.get(a.id);
    const som = somById.get(a.id);
    const image_pct = img && img.sessions > 0
      ? Math.round((img.hits / img.sessions) * 100)
      : null;
    const video_pct = vid && vid.sessions > 0
      ? Math.round((vid.hits / vid.sessions) * 100)
      : null;
    return {
      id: a.id,
      name: a.name,
      attendance_pct,
      image_pct,
      video_pct,
      som_count: som?.som_count ?? 0,
      village_count: som?.village_count ?? 0,
    };
  });

  const enriched: HomeFocusArea[] = [];
  for (const r of rows) {
    const { score, som_pct } = childHealthScore(r);
    if (score === null) continue;
    enriched.push({
      level: childLevel,
      id: r.id,
      name: r.name,
      health_score: score,
      attendance_pct: r.attendance_pct,
      image_pct: r.image_pct,
      video_pct: r.video_pct,
      som_pct,
      dominant_gap_kind: dominantGapKind(
        r.attendance_pct, r.image_pct, r.video_pct, som_pct,
      ),
    });
  }
  enriched.sort((a, b) => a.health_score - b.health_score);
  return enriched.slice(0, 3);
}

export type HomePayload = {
  scope: HomeScope;
  window: HomeWindow;
  period: DateWindow;
  health_score: {
    current: number | null;
    previous: number | null;
    delta: number | null;
  };
  // Doer-only. Present iff the caller has any `.write` capability;
  // observers always see `null`. The doer client opens the natural
  // write path on tap; the observer client doesn't render the card.
  mission: HomeMission | null;
  // Same payload for both branches. Doer client renders the
  // dominant-gap label per row ("needs X"); observer client renders
  // the full 4-KPI strip + Health Score. D19 (revised) — the full
  // sibling-compare grid lives on `/dashboard`, not on Home.
  focus_areas: HomeFocusArea[];
};

dashboard.get('/home', requireCap('dashboard.read'), async (c) => {
  const user = c.get('user');
  const today = todayIstDate();
  const windowParam = c.req.query('window') ?? '7d';
  if (!isHomeWindow(windowParam)) {
    return err(c, 'bad_request', 400, `window must be one of ${HOME_WINDOWS.join('|')}`);
  }
  const scopeParsed = parseHomeScope(c.req.query('scope'), user);
  if ('error' in scopeParsed) return err(c, 'bad_request', 400, scopeParsed.error);

  const scopeVillages = await villageIdsInScope(c.env.DB, user);
  const effective = await effectiveVillages(
    c.env.DB, scopeVillages, scopeParsed.level, scopeParsed.id,
  );
  if (effective === 'out_of_scope') return err(c, 'forbidden', 403, 'out of scope');

  const windows = resolveHomeWindows(windowParam, today);
  const villageCount = effective.length;

  // Both windows in parallel. `skipChart=true` for both — the 6-month
  // chart belongs to /dashboard's consolidated fold; Home only needs
  // the KPIs to derive Health Score and Mission.
  const [current, previous] = await Promise.all([
    buildConsolidated(c.env.DB, effective, windows.current.from, windows.current.to, true),
    buildConsolidated(c.env.DB, effective, windows.previous.from, windows.previous.to, true),
  ]);

  const currentScore = computeHealthScore(current, villageCount);
  const previousScore = computeHealthScore(previous, villageCount);
  const delta =
    currentScore !== null && previousScore !== null
      ? currentScore - previousScore
      : null;

  // "Doer" = has any `.write` capability. Strictly cap-shape, never
  // role-name — adding a future observer role with only `.read` caps
  // automatically lands on the observer branch with no edit here.
  const userCaps = capabilitiesFor(user.role);
  const hasAnyWrite = userCaps.some((cap) => cap.endsWith('.write'));

  const mission = hasAnyWrite ? pickMission(current, villageCount) : null;
  const focusAreas = await buildHomeFocusAreas(
    c.env.DB, effective, scopeParsed.level, windows.current,
  );

  const payload: HomePayload = {
    scope: scopeParsed,
    window: windowParam,
    period: windows.current,
    health_score: { current: currentScore, previous: previousScore, delta },
    mission,
    focus_areas: focusAreas,
  };
  return c.json(payload);
});

dashboard.get('/drilldown', requireCap('dashboard.read'), async (c) => {
  const result = await handleDrillDownRequest(c);
  if (result instanceof Response) return result;
  return c.json(result);
});

dashboard.get('/drilldown.csv', requireCap('dashboard.read'), async (c) => {
  const result = await handleDrillDownRequest(c);
  if (result instanceof Response) return result;
  const metricParam = c.req.query('metric') as Metric;

  // §3.6.3: "CSV mirrors the on-screen table exactly". We don't
  // prepend a context line — Excel / pandas don't treat `#` as a
  // comment, so a leading `# India > …` surfaces as a rogue 1-cell
  // row. Context lives in the filename instead: for india the trail
  // is already implied by the metric, so skip the crumb suffix; for
  // any other level, the deepest crumb (zone / cluster / village
  // name) labels the slice, and the period, when present, fixes the
  // time window so a second export doesn't overwrite the first in
  // the user's downloads folder. decisions.md D5.
  const periodSuffix = result.period
    ? `_${result.period.from}_to_${result.period.to}`
    : '';
  const scopeSuffix = result.level === 'india'
    ? ''
    : `_${result.crumbs.at(-1)?.name ?? result.level}`;
  const filenameBase = `${metricParam}_${result.level}${scopeSuffix}${periodSuffix}`;
  const csv = toCsv(result.headers, result.rows);
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFilename(filenameBase)}"`,
    },
  });
});

export default dashboard;
