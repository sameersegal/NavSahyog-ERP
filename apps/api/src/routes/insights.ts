// Insights route — powers the home KPI strip and the at-risk /
// top-village cards that sit above the drill-down table. Everything
// is derived from existing tables; no new columns. Scope rules are
// the same as the rest of the app — villageIdsInScope decides what
// the user is allowed to see.
//
// Design choice: this route is computed rather than precomputed /
// persisted. Back-of-envelope: 3 villages × 20 sessions × 7 kids =
// 420 marks in the fixture seed; the WHERE date >= '…' predicate
// with the existing attendance_session / attendance_mark indexes
// keeps the scan sub-linear. At real-world scale (say 500 villages,
// 50 kids, one session/day/village) the largest scan is 500 × 7 ×
// 50 = 175 000 rows for the weekly KPI — well inside D1's budget.
// If this ever becomes hot we can KV-cache on a 5-minute TTL.

import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { villageIdsInScope } from '../scope';
import { todayIstDate } from '../lib/time';
import { err } from '../lib/errors';
import {
  breadcrumbFor,
  childLevelOf,
  effectiveVillages,
  GEO_JOIN,
  isGeoLevel,
  LEVEL_ALIAS,
  type GeoLevel,
  type NonRootLevel,
} from '../lib/geo';
import {
  AT_RISK_THRESHOLD_DAYS,
  KPI_SPARK_POINTS,
  type BreadcrumbCrumb,
  type HierarchyChild,
  type InsightKpi,
  type InsightsResponse,
  type VillageActivity,
} from '@navsahyog/shared';
import type { Bindings, SessionUser, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

// Walked by scripts/gen-matrix.mjs.
export const meta: RouteMeta = {
  context: 'dashboard',
  resource: 'insights',
  cra: 'read-only',
  offline: { read: 'online-only' },
  refs: ['§3.6'],
};

const insights = new Hono<{ Bindings: Bindings; Variables: Variables }>();

insights.use('*', requireAuth);

// IST-date arithmetic — string-in, string-out. Matches the way the
// rest of the code treats calendar dates (TEXT 'YYYY-MM-DD').
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Whole-day difference between two IST calendar dates. `from` and
// `to` are 'YYYY-MM-DD'. Returns an integer, positive when `to` is
// later than `from`.
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  const fMs = Date.UTC(fy, fm - 1, fd);
  const tMs = Date.UTC(ty, tm - 1, td);
  return Math.round((tMs - fMs) / 86_400_000);
}

// Human-readable label for the current drill position. "India" at
// the root, otherwise the entity's own name (e.g. "Bidar Cluster
// 1"). Called after scope validation, so the (level, id) pair is
// known to resolve.
async function scopeLabelAt(
  db: D1Database,
  level: GeoLevel,
  id: number | null,
): Promise<string> {
  if (level === 'india' || id === null) return 'India';
  const row = await db
    .prepare(`SELECT name FROM ${level} WHERE id = ?`)
    .bind(id)
    .first<{ name: string }>();
  return row?.name ?? 'India';
}

// Resolve the user's default drill position — their scope floor.
// Super admins (scope_level='global') land at india; every other
// role lands at the entity their role is rooted under (a cluster
// admin at their cluster, a VC at their village). The Home page
// starts the drill from this point unless the URL asks deeper.
function scopeFloorFor(
  user: SessionUser,
): { level: GeoLevel; id: number | null } {
  if (user.scope_level === 'global' || user.scope_id === null) {
    return { level: 'india', id: null };
  }
  return { level: user.scope_level as GeoLevel, id: user.scope_id };
}

// Resolve + validate the (level, id) the caller asked for. Falls
// back to the user's scope floor when params are absent. Returns
// 'bad_request' for malformed input, 'out_of_scope' when the
// requested subtree doesn't intersect the user's scope.
type ResolvedDrill =
  | { level: GeoLevel; id: number | null; effective: number[] }
  | { error: 'bad_request' | 'out_of_scope' };

async function resolveDrill(
  db: D1Database,
  user: SessionUser,
  scopeIds: number[],
  qLevel: string | undefined,
  qId: string | undefined,
): Promise<ResolvedDrill> {
  let level: GeoLevel;
  let id: number | null;
  if (qLevel === undefined && qId === undefined) {
    const floor = scopeFloorFor(user);
    level = floor.level;
    id = floor.id;
  } else {
    if (!isGeoLevel(qLevel)) return { error: 'bad_request' };
    if (qLevel === 'india') {
      if (qId !== undefined) return { error: 'bad_request' };
      level = 'india';
      id = null;
    } else {
      if (qId === undefined) return { error: 'bad_request' };
      const parsed = Number(qId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { error: 'bad_request' };
      }
      level = qLevel;
      id = parsed;
    }
  }

  const effective = await effectiveVillages(db, scopeIds, level, id);
  if (effective === 'out_of_scope') return { error: 'out_of_scope' };
  return { level, id, effective };
}

type VillageCore = {
  id: number;
  name: string;
  cluster_name: string;
  coordinator_name: string | null;
  children_count: number;
};

async function villageCores(
  db: D1Database,
  ids: number[],
): Promise<VillageCore[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  // coordinator_name comes from a correlated subquery that picks the
  // (village-scoped) VC for each village. Same shape the /api/villages
  // route uses, so the data behind both surfaces stays consistent.
  const rs = await db
    .prepare(
      `SELECT v.id, v.name, c.name AS cluster_name,
              (
                SELECT u.full_name FROM user u
                 WHERE u.role = 'vc'
                   AND u.scope_level = 'village'
                   AND u.scope_id = v.id
                 ORDER BY u.id
                 LIMIT 1
              ) AS coordinator_name,
              COALESCE(kids.cnt, 0) AS children_count
         FROM village v
         JOIN cluster c ON c.id = v.cluster_id
         LEFT JOIN (
           SELECT village_id, COUNT(*) AS cnt FROM student
            WHERE graduated_at IS NULL
            GROUP BY village_id
         ) kids ON kids.village_id = v.id
        WHERE v.id IN (${placeholders})
        ORDER BY v.name`,
    )
    .bind(...ids)
    .all<VillageCore>();
  return rs.results;
}

type VillageWeekly = {
  village_id: number;
  sessions_this_week: number;
  marks_total: number;
  marks_present: number;
  last_session_date: string | null;
};

async function villageWeekly(
  db: D1Database,
  ids: number[],
  weekFrom: string,
  weekTo: string,
): Promise<Map<number, VillageWeekly>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  // One pass: weekly counts + all-time last-session date per village.
  // We can't COUNT(DISTINCT) across a filter in a single aggregate
  // cleanly, so we fan out the joins instead — attendance volume
  // per village is tiny (hundreds, not millions) so this is fine.
  const rs = await db
    .prepare(
      `SELECT s.village_id AS village_id,
              COUNT(DISTINCT CASE WHEN s.date BETWEEN ? AND ? THEN s.id END) AS sessions_this_week,
              SUM(CASE WHEN s.date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS marks_total,
              SUM(CASE WHEN s.date BETWEEN ? AND ? AND m.present = 1 THEN 1 ELSE 0 END) AS marks_present,
              MAX(s.date) AS last_session_date
         FROM attendance_session s
         LEFT JOIN attendance_mark m ON m.session_id = s.id
        WHERE s.village_id IN (${placeholders})
        GROUP BY s.village_id`,
    )
    .bind(weekFrom, weekTo, weekFrom, weekTo, weekFrom, weekTo, ...ids)
    .all<VillageWeekly>();
  const out = new Map<number, VillageWeekly>();
  for (const row of rs.results) out.set(row.village_id, row);
  return out;
}

function buildActivity(
  today: string,
  core: VillageCore,
  weekly: VillageWeekly | undefined,
): VillageActivity {
  const sessions = weekly?.sessions_this_week ?? 0;
  const marksTotal = weekly?.marks_total ?? 0;
  const marksPresent = weekly?.marks_present ?? 0;
  const attendancePct =
    marksTotal > 0 ? Math.round((marksPresent / marksTotal) * 100) : null;
  const days =
    weekly?.last_session_date != null
      ? daysBetween(weekly.last_session_date, today)
      : null;
  return {
    village_id: core.id,
    village_name: core.name,
    cluster_name: core.cluster_name,
    coordinator_name: core.coordinator_name,
    children_count: core.children_count,
    sessions_this_week: sessions,
    attendance_pct_week: attendancePct,
    days_since_last_session: days,
    at_risk:
      days === null ? true : days >= AT_RISK_THRESHOLD_DAYS,
  };
}

// Overall attendance % across a date range for the given villages.
async function overallAttendancePct(
  db: D1Database,
  ids: number[],
  from: string,
  to: string,
): Promise<number | null> {
  if (ids.length === 0) return null;
  const placeholders = ids.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT SUM(CASE WHEN m.present = 1 THEN 1 ELSE 0 END) AS present,
              COUNT(*) AS total
         FROM attendance_session s
         JOIN attendance_mark m ON m.session_id = s.id
        WHERE s.village_id IN (${placeholders})
          AND s.date BETWEEN ? AND ?`,
    )
    .bind(...ids, from, to)
    .first<{ present: number | null; total: number | null }>();
  const total = row?.total ?? 0;
  if (total === 0) return null;
  const present = row?.present ?? 0;
  return Math.round((present / total) * 100);
}

async function achievementsInMonth(
  db: D1Database,
  ids: number[],
  monthPrefix: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM achievement a
        JOIN student st ON st.id = a.student_id
       WHERE st.village_id IN (${placeholders})
         AND a.date LIKE ? || '%'`,
    )
    .bind(...ids, monthPrefix)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Count of media rows of a given kind in a calendar month. `captured_at`
// is a UTC epoch; we compare it against a 'YYYY-MM' prefix by using
// strftime so the query works identically for images and videos. Soft-
// deleted rows (deleted_at IS NOT NULL) are excluded — the KPI counts
// what a user currently has, not what was ever captured.
async function mediaInMonth(
  db: D1Database,
  ids: number[],
  kind: 'image' | 'video',
  monthPrefix: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM media
        WHERE village_id IN (${placeholders})
          AND kind = ?
          AND deleted_at IS NULL
          AND strftime('%Y-%m', captured_at, 'unixepoch') = ?`,
    )
    .bind(...ids, kind, monthPrefix)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Per-day attendance counts across a window, keyed by 'YYYY-MM-DD'.
// Returning the pair (not the already-divided %) lets the caller
// roll days into weekly buckets correctly — (present/total) is not
// commutative with SUM.
async function dailyAttendanceCounts(
  db: D1Database,
  ids: number[],
  from: string,
  to: string,
): Promise<Map<string, { present: number; total: number }>> {
  const out = new Map<string, { present: number; total: number }>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT s.date AS date,
              SUM(CASE WHEN m.present = 1 THEN 1 ELSE 0 END) AS present,
              COUNT(m.id) AS total
         FROM attendance_session s
         LEFT JOIN attendance_mark m ON m.session_id = s.id
        WHERE s.village_id IN (${placeholders})
          AND s.date BETWEEN ? AND ?
        GROUP BY s.date`,
    )
    .bind(...ids, from, to)
    .all<{ date: string; present: number | null; total: number | null }>();
  for (const r of rs.results) {
    out.set(r.date, { present: r.present ?? 0, total: r.total ?? 0 });
  }
  return out;
}

// Per-day achievement count across a window, keyed by 'YYYY-MM-DD'.
async function dailyAchievementCounts(
  db: D1Database,
  ids: number[],
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT a.date AS date, COUNT(*) AS n
         FROM achievement a
         JOIN student st ON st.id = a.student_id
        WHERE st.village_id IN (${placeholders})
          AND a.date BETWEEN ? AND ?
        GROUP BY a.date`,
    )
    .bind(...ids, from, to)
    .all<{ date: string; n: number }>();
  for (const r of rs.results) out.set(r.date, r.n);
  return out;
}

// Per-village media count for a given kind + calendar month.
// Keyed by village_id so the per-child rollup can fold these in
// alongside the weekly attendance map. `captured_at` is a UTC
// epoch; IST calendar-month prefix via strftime. Soft-deleted
// rows excluded.
async function perVillageMediaInMonth(
  db: D1Database,
  ids: number[],
  kind: 'image' | 'video',
  monthPrefix: string,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT village_id, COUNT(*) AS n FROM media
        WHERE village_id IN (${placeholders})
          AND kind = ?
          AND deleted_at IS NULL
          AND strftime('%Y-%m', captured_at, 'unixepoch') = ?
        GROUP BY village_id`,
    )
    .bind(...ids, kind, monthPrefix)
    .all<{ village_id: number; n: number }>();
  for (const r of rs.results) out.set(r.village_id, r.n);
  return out;
}

// Per-village achievement count for a calendar month (any type —
// SoM / gold / silver rolled together; the ops question the child
// tile answers is "did anything get celebrated here this month?",
// not the type mix). Folded the same way as media.
async function perVillageAchievementsInMonth(
  db: D1Database,
  ids: number[],
  monthPrefix: string,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT st.village_id AS village_id, COUNT(*) AS n
         FROM achievement a
         JOIN student st ON st.id = a.student_id
        WHERE st.village_id IN (${placeholders})
          AND a.date LIKE ? || '%'
        GROUP BY st.village_id`,
    )
    .bind(...ids, monthPrefix)
    .all<{ village_id: number; n: number }>();
  for (const r of rs.results) out.set(r.village_id, r.n);
  return out;
}

// Per-day media count for a given kind. `captured_at` is a UTC
// epoch; we convert to a 'YYYY-MM-DD' key via strftime so the
// series is a day-keyed Map matching the attendance / achievement
// shape. Soft-deleted rows (deleted_at NOT NULL) are excluded.
async function dailyMediaCounts(
  db: D1Database,
  ids: number[],
  kind: 'image' | 'video',
  fromIso: string,
  toIso: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d', captured_at, 'unixepoch') AS date,
              COUNT(*) AS n
         FROM media
        WHERE village_id IN (${placeholders})
          AND kind = ?
          AND deleted_at IS NULL
          AND strftime('%Y-%m-%d', captured_at, 'unixepoch') BETWEEN ? AND ?
        GROUP BY date`,
    )
    .bind(...ids, kind, fromIso, toIso)
    .all<{ date: string; n: number }>();
  for (const r of rs.results) out.set(r.date, r.n);
  return out;
}

// Week index for a day within the 12-week sparkline window ending
// today. 0 = oldest week, KPI_SPARK_POINTS-1 = current week. Returns
// null for days outside the window (including future days).
function weekIndexOf(dateIso: string, todayIso: string): number | null {
  const diff = daysBetween(dateIso, todayIso); // ≥0 when dateIso ≤ todayIso
  if (diff < 0 || diff >= KPI_SPARK_POINTS * 7) return null;
  return KPI_SPARK_POINTS - 1 - Math.floor(diff / 7);
}

// 12-week rollup of a per-day count Map. Each bucket is a 7-day sum.
// Counts default to 0 — "no images this week" is a real zero, not a
// gap; the sparkline renders as the floor rather than a break.
function rollSparkCount(
  daily: Map<string, number>,
  today: string,
): Array<number | null> {
  const buckets: Array<number | null> = new Array(KPI_SPARK_POINTS).fill(0);
  for (const [date, n] of daily) {
    const wi = weekIndexOf(date, today);
    if (wi !== null) buckets[wi] = (buckets[wi] as number) + n;
  }
  return buckets;
}

// 12-week rollup of a per-day (present, total) Map into weekly %s.
// A week with zero marks returns null so the sparkline draws a gap
// rather than pretending 0% — "no session" and "everyone absent"
// are very different signals.
function rollSparkPct(
  daily: Map<string, { present: number; total: number }>,
  today: string,
): Array<number | null> {
  const pres = new Array(KPI_SPARK_POINTS).fill(0);
  const tot = new Array(KPI_SPARK_POINTS).fill(0);
  for (const [date, { present, total }] of daily) {
    const wi = weekIndexOf(date, today);
    if (wi !== null) {
      pres[wi] += present;
      tot[wi] += total;
    }
  }
  return tot.map((t, i) => (t === 0 ? null : Math.round((pres[i] / t) * 100)));
}

function deltaTrend(current: number, prev: number | null): {
  delta: number | null;
  trend: 'up' | 'down' | 'flat' | null;
} {
  if (prev === null) return { delta: null, trend: null };
  const d = current - prev;
  if (d === 0) return { delta: 0, trend: 'flat' };
  return { delta: d, trend: d > 0 ? 'up' : 'down' };
}

// IST 'YYYY-MM-01' at the start of a calendar month N months before
// the month containing `fromIso`. `N=0` returns the first of
// fromIso's own month.
function addMonths(fromIso: string, months: number): string {
  const [y, m] = fromIso.slice(0, 7).split('-').map(Number) as [number, number];
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

// Maps each in-scope village to its ancestor at the given child
// level (e.g. child_level='zone' → village_id → zone id/name). A
// single walk up GEO_JOIN per call; results join cleanly with the
// per-village cores + weekly maps used for the rest of the page.
async function villageAncestors(
  db: D1Database,
  ids: number[],
  childLevel: NonRootLevel,
): Promise<Map<number, { id: number; name: string }>> {
  const out = new Map<number, { id: number; name: string }>();
  if (ids.length === 0) return out;
  const alias = LEVEL_ALIAS[childLevel];
  const placeholders = ids.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT v.id AS village_id, ${alias}.id AS child_id, ${alias}.name AS child_name
       ${GEO_JOIN}
       WHERE v.id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<{ village_id: number; child_id: number; child_name: string }>();
  for (const r of rs.results) {
    out.set(r.village_id, { id: r.child_id, name: r.child_name });
  }
  return out;
}

// Roll per-village cores + weekly activity into HierarchyChild
// tiles keyed at the target child level. Village leaves use each
// village as its own "child" and carry coordinator_name; higher
// levels sum villages_count, children_count, sessions, marks, and
// take the max last_session_date. A zero at higher levels stays
// meaningful — "this zone ran nothing this week" is the actionable
// signal, not noise.
//
// Monthly counters (images / videos / achievements) come in as
// per-village maps and fold the same way as weekly marks. These
// power the "compare at a glance" columns on Home's child grid —
// each child tile carries the same KPIs the scope strip shows, so
// two siblings can be compared horizontally without drilling.
function buildHierarchyChildren(
  today: string,
  childLevel: NonRootLevel,
  cores: VillageCore[],
  weekly: Map<number, VillageWeekly>,
  ancestors: Map<number, { id: number; name: string }>,
  imagesByVillage: Map<number, number>,
  videosByVillage: Map<number, number>,
  achievementsByVillage: Map<number, number>,
): HierarchyChild[] {
  if (childLevel === 'village') {
    return cores.map((core) => {
      const w = weekly.get(core.id);
      const marksTotal = w?.marks_total ?? 0;
      const marksPresent = w?.marks_present ?? 0;
      const pct =
        marksTotal > 0 ? Math.round((marksPresent / marksTotal) * 100) : null;
      const days =
        w?.last_session_date != null
          ? daysBetween(w.last_session_date, today)
          : null;
      return {
        level: 'village',
        id: core.id,
        name: core.name,
        children_count: core.children_count,
        sessions_this_week: w?.sessions_this_week ?? 0,
        attendance_pct_week: pct,
        days_since_last_session: days,
        at_risk: days === null ? true : days >= AT_RISK_THRESHOLD_DAYS,
        coordinator_name: core.coordinator_name,
        villages_count: 1,
        images_this_month: imagesByVillage.get(core.id) ?? 0,
        videos_this_month: videosByVillage.get(core.id) ?? 0,
        achievements_this_month: achievementsByVillage.get(core.id) ?? 0,
      };
    });
  }

  // Higher levels: fold villages under their shared ancestor.
  type Bucket = {
    id: number;
    name: string;
    villages_count: number;
    children_count: number;
    sessions_this_week: number;
    marks_present: number;
    marks_total: number;
    last_session_date: string | null;
    images_this_month: number;
    videos_this_month: number;
    achievements_this_month: number;
  };
  const buckets = new Map<number, Bucket>();
  for (const core of cores) {
    const anc = ancestors.get(core.id);
    if (!anc) continue;
    let b = buckets.get(anc.id);
    if (!b) {
      b = {
        id: anc.id,
        name: anc.name,
        villages_count: 0,
        children_count: 0,
        sessions_this_week: 0,
        marks_present: 0,
        marks_total: 0,
        last_session_date: null,
        images_this_month: 0,
        videos_this_month: 0,
        achievements_this_month: 0,
      };
      buckets.set(anc.id, b);
    }
    b.villages_count += 1;
    b.children_count += core.children_count;
    b.images_this_month += imagesByVillage.get(core.id) ?? 0;
    b.videos_this_month += videosByVillage.get(core.id) ?? 0;
    b.achievements_this_month += achievementsByVillage.get(core.id) ?? 0;
    const w = weekly.get(core.id);
    if (w) {
      b.sessions_this_week += w.sessions_this_week ?? 0;
      b.marks_present += w.marks_present ?? 0;
      b.marks_total += w.marks_total ?? 0;
      if (
        w.last_session_date !== null &&
        (b.last_session_date === null || w.last_session_date > b.last_session_date)
      ) {
        b.last_session_date = w.last_session_date;
      }
    }
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => {
      const pct =
        b.marks_total > 0
          ? Math.round((b.marks_present / b.marks_total) * 100)
          : null;
      const days =
        b.last_session_date !== null
          ? daysBetween(b.last_session_date, today)
          : null;
      return {
        level: childLevel,
        id: b.id,
        name: b.name,
        children_count: b.children_count,
        sessions_this_week: b.sessions_this_week,
        attendance_pct_week: pct,
        days_since_last_session: days,
        at_risk: days === null ? true : days >= AT_RISK_THRESHOLD_DAYS,
        coordinator_name: null,
        villages_count: b.villages_count,
        images_this_month: b.images_this_month,
        videos_this_month: b.videos_this_month,
        achievements_this_month: b.achievements_this_month,
      };
    });
}

// Share of in-scope villages with at least one Star of the Month
// declared in the given calendar month, as a whole-number
// percentage (0–100). The denominator is every village in scope
// (including villages that never ran anything this month) so the
// tile reads as "how close to 100% declared are we?" — ops wants
// the signal that stragglers exist, not just that somebody
// somewhere in scope remembered.
async function somDeclaredPctInMonth(
  db: D1Database,
  ids: number[],
  monthPrefix: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT st.village_id) AS declared
         FROM achievement a
         JOIN student st ON st.id = a.student_id
        WHERE st.village_id IN (${placeholders})
          AND a.type = 'som'
          AND a.date LIKE ? || '%'`,
    )
    .bind(...ids, monthPrefix)
    .first<{ declared: number }>();
  const declared = row?.declared ?? 0;
  return Math.round((declared / ids.length) * 100);
}

insights.get('/', requireCap('dashboard.read'), async (c) => {
  const user = c.get('user');
  const scopeIds = await villageIdsInScope(c.env.DB, user);

  // Drill-down params — optional. Default to the user's scope floor
  // (india for super admin, cluster for cluster admin, etc.). The
  // URL never exceeds the user's scope: `effectiveVillages` gates
  // any attempt to drill into another subtree.
  const drill = await resolveDrill(
    c.env.DB,
    user,
    scopeIds,
    c.req.query('level'),
    c.req.query('id'),
  );
  if ('error' in drill) {
    if (drill.error === 'out_of_scope') {
      return err(c, 'forbidden', 403, 'out of scope');
    }
    return err(c, 'bad_request', 400, 'invalid level/id');
  }
  const { level, id, effective: ids } = drill;

  const today = todayIstDate();
  const weekStart = addDays(today, -6); // 7-day window inclusive
  const prevWeekStart = addDays(today, -13);
  const prevWeekEnd = addDays(today, -7);
  const monthPrefix = today.slice(0, 7);
  const prevMonthPrefix = addMonths(today, -1).slice(0, 7);
  // 12-week sparkline window, inclusive of both endpoints.
  const sparkStart = addDays(today, -(KPI_SPARK_POINTS * 7 - 1));

  // Child level (one step below the current drill position). Null
  // means village leaf — tiles deep-link to /village/:id rather than
  // drilling further inside insights.
  const childLevel = childLevelOf(level);

  const [
    scopeLabel,
    crumbs,
    cores,
    weekly,
    ancestors,
    imagesByVillage,
    videosByVillage,
    achievementsByVillage,
  ] = await Promise.all([
    scopeLabelAt(c.env.DB, level, id),
    breadcrumbFor(c.env.DB, level, id),
    villageCores(c.env.DB, ids),
    villageWeekly(c.env.DB, ids, prevWeekStart, today),
    childLevel && childLevel !== 'village'
      ? villageAncestors(c.env.DB, ids, childLevel)
      : Promise.resolve(new Map<number, { id: number; name: string }>()),
    // Per-village monthly counts feed the child-grid comparison
    // columns. Fanned out in parallel alongside the other reads —
    // three small GROUP BY queries, cheap in D1.
    childLevel !== null
      ? perVillageMediaInMonth(c.env.DB, ids, 'image', monthPrefix)
      : Promise.resolve(new Map<number, number>()),
    childLevel !== null
      ? perVillageMediaInMonth(c.env.DB, ids, 'video', monthPrefix)
      : Promise.resolve(new Map<number, number>()),
    childLevel !== null
      ? perVillageAchievementsInMonth(c.env.DB, ids, monthPrefix)
      : Promise.resolve(new Map<number, number>()),
  ]);

  const allVillages = cores.map((v) => buildActivity(today, v, weekly.get(v.id)));
  const children: HierarchyChild[] =
    childLevel === null
      ? []
      : buildHierarchyChildren(
          today,
          childLevel,
          cores,
          weekly,
          ancestors,
          imagesByVillage,
          videosByVillage,
          achievementsByVillage,
        );

  // KPI values + 12-week spark series fan out in parallel — D1
  // queries are cheap individually but serialising them adds up on
  // slow links. Spark queries return per-day counts across the
  // 84-day window; we roll into weekly buckets in JS.
  const [
    attThisWeek,
    attPrevWeek,
    achThisMonth,
    achPrevMonth,
    imagesThisMonth,
    imagesPrevMonth,
    videosThisMonth,
    videosPrevMonth,
    dailyAtt,
    dailyAch,
    dailyImg,
    dailyVid,
    somDeclaredPct,
  ] = await Promise.all([
    overallAttendancePct(c.env.DB, ids, weekStart, today),
    overallAttendancePct(c.env.DB, ids, prevWeekStart, prevWeekEnd),
    achievementsInMonth(c.env.DB, ids, monthPrefix),
    achievementsInMonth(c.env.DB, ids, prevMonthPrefix),
    mediaInMonth(c.env.DB, ids, 'image', monthPrefix),
    mediaInMonth(c.env.DB, ids, 'image', prevMonthPrefix),
    mediaInMonth(c.env.DB, ids, 'video', monthPrefix),
    mediaInMonth(c.env.DB, ids, 'video', prevMonthPrefix),
    dailyAttendanceCounts(c.env.DB, ids, sparkStart, today),
    dailyAchievementCounts(c.env.DB, ids, sparkStart, today),
    dailyMediaCounts(c.env.DB, ids, 'image', sparkStart, today),
    dailyMediaCounts(c.env.DB, ids, 'video', sparkStart, today),
    somDeclaredPctInMonth(c.env.DB, ids, monthPrefix),
  ]);

  const attendanceSpark = rollSparkPct(dailyAtt, today);
  const achievementSpark = rollSparkCount(dailyAch, today);
  const imageSpark = rollSparkCount(dailyImg, today);
  const videoSpark = rollSparkCount(dailyVid, today);

  const totalChildren = cores.reduce((a, v) => a + v.children_count, 0);
  const atRiskCount = allVillages.filter((v) => v.at_risk).length;

  const attDelta = deltaTrend(attThisWeek ?? 0, attPrevWeek);
  const achDelta = deltaTrend(achThisMonth, achPrevMonth);
  const imgDelta = deltaTrend(imagesThisMonth, imagesPrevMonth);
  const vidDelta = deltaTrend(videosThisMonth, videosPrevMonth);

  // Tile order mirrors the hierarchy ops cares about: children (how
  // big is the program?) → attendance (are we running?) → content
  // (are we documenting?) → achievements (are kids winning?) →
  // at-risk (is anything broken?). "Villages" count is no longer a
  // KPI tile because the village grid below is itself the answer.
  const kpis: InsightKpi[] = [
    {
      label: 'children',
      value: totalChildren,
      delta: null,
      trend: null,
      hint: null,
      // Headcount isn't a weekly series — skip the spark.
      spark: null,
    },
    {
      label: 'attendance_week',
      value: attThisWeek ?? 0,
      delta: attDelta.delta,
      trend: attDelta.trend,
      hint: attPrevWeek === null ? null : 'vs_prev_week',
      spark: attendanceSpark,
    },
    {
      label: 'images_month',
      value: imagesThisMonth,
      delta: imgDelta.delta,
      trend: imgDelta.trend,
      hint: imagesPrevMonth === 0 && imagesThisMonth === 0 ? null : 'vs_prev_month',
      spark: imageSpark,
    },
    {
      label: 'videos_month',
      value: videosThisMonth,
      delta: vidDelta.delta,
      trend: vidDelta.trend,
      hint: videosPrevMonth === 0 && videosThisMonth === 0 ? null : 'vs_prev_month',
      spark: videoSpark,
    },
    {
      label: 'achievements_month',
      value: achThisMonth,
      delta: achDelta.delta,
      trend: achDelta.trend,
      hint: achPrevMonth === null ? null : 'vs_prev_month',
      spark: achievementSpark,
    },
    {
      label: 'at_risk',
      value: atRiskCount,
      delta: null,
      // Higher at-risk is bad — we invert the sense so "trend: up"
      // always reads green on the client.
      trend: atRiskCount === 0 ? 'up' : atRiskCount > allVillages.length / 3 ? 'down' : 'flat',
      hint: null,
      // At-risk is derived from today's state (days_since_last_session);
      // reconstructing its weekly history would need a per-week scan
      // that isn't worth the complexity right now.
      spark: null,
    },
  ];

  const topVillages = [...allVillages]
    .filter((v) => v.attendance_pct_week !== null)
    .sort((a, b) => (b.attendance_pct_week ?? 0) - (a.attendance_pct_week ?? 0))
    .slice(0, 5);

  const atRiskVillages = allVillages
    .filter((v) => v.at_risk)
    .sort((a, b) => {
      // Most-lapsed first; villages that never ran a session sort
      // above anything else.
      const ad = a.days_since_last_session;
      const bd = b.days_since_last_session;
      if (ad === null && bd === null) return 0;
      if (ad === null) return -1;
      if (bd === null) return 1;
      return bd - ad;
    });

  const body: InsightsResponse = {
    scope_label: scopeLabel,
    level,
    id,
    crumbs,
    child_level: childLevel,
    children,
    kpis,
    top_villages: topVillages,
    at_risk_villages: atRiskVillages,
    som_declared_pct: somDeclaredPct,
  };
  return c.json(body);
});

export default insights;
