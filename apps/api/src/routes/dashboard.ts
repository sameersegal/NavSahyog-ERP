import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { villageIdsInScope } from '../scope';
import { isIsoDate, todayIstDate } from '../lib/time';
import { err } from '../lib/errors';
import { csvFilename, toCsv, type CsvCell } from '../lib/csv';
import {
  childLevelOf,
  GEO_JOIN,
  GEO_LEVELS,
  isGeoLevel,
  LEVEL_ALIAS,
  type GeoLevel,
  type NonRootLevel,
} from '../lib/geo';
import type { Bindings, Variables } from '../types';

// Five tiles per spec §3.6.1.
const METRICS = ['vc', 'af', 'children', 'attendance', 'achievements'] as const;
type Metric = (typeof METRICS)[number];

function isMetric(value: unknown): value is Metric {
  return typeof value === 'string' && (METRICS as readonly string[]).includes(value);
}

type Crumb = { level: GeoLevel; id: number | null; name: string };

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

// Villages under (level, id) — no scope filter yet. For india, no
// filter at all.
async function villagesUnder(
  db: D1Database,
  level: GeoLevel,
  id: number | null,
): Promise<number[]> {
  if (level === 'india') {
    const rs = await db.prepare('SELECT id FROM village').all<{ id: number }>();
    return rs.results.map((r) => r.id);
  }
  if (id === null) return [];
  const alias = LEVEL_ALIAS[level];
  const sql = `SELECT v.id AS id ${GEO_JOIN} WHERE ${alias}.id = ?`;
  const rs = await db.prepare(sql).bind(id).all<{ id: number }>();
  return rs.results.map((r) => r.id);
}

// Breadcrumb for (level, id). Always starts with India and walks
// down to the requested level. Used by the UI to render the trail
// and by the CSV header row.
async function breadcrumbFor(
  db: D1Database,
  level: GeoLevel,
  id: number | null,
): Promise<Crumb[]> {
  const crumbs: Crumb[] = [{ level: 'india', id: null, name: 'India' }];
  if (level === 'india' || id === null) return crumbs;
  const rs = await db
    .prepare(
      `SELECT z.id AS zone_id, z.name AS zone_name,
              st.id AS state_id, st.name AS state_name,
              r.id  AS region_id,   r.name  AS region_name,
              d.id  AS district_id, d.name  AS district_name,
              c.id  AS cluster_id,  c.name  AS cluster_name,
              v.id  AS village_id,  v.name  AS village_name
       ${GEO_JOIN}
       WHERE ${LEVEL_ALIAS[level]}.id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<{
      zone_id: number; zone_name: string;
      state_id: number; state_name: string;
      region_id: number; region_name: string;
      district_id: number; district_name: string;
      cluster_id: number; cluster_name: string;
      village_id: number; village_name: string;
    }>();
  if (!rs) return crumbs;
  const ordered: Array<[GeoLevel, number, string]> = [
    ['zone', rs.zone_id, rs.zone_name],
    ['state', rs.state_id, rs.state_name],
    ['region', rs.region_id, rs.region_name],
    ['district', rs.district_id, rs.district_name],
    ['cluster', rs.cluster_id, rs.cluster_name],
    ['village', rs.village_id, rs.village_name],
  ];
  const stopAt = GEO_LEVELS.indexOf(level);
  for (let i = 0; i < stopAt; i++) {
    const [lvl, cid, cname] = ordered[i]!;
    crumbs.push({ level: lvl, id: cid, name: cname });
  }
  return crumbs;
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

// Intersection of scope and requested area. Returns 'out_of_scope'
// when the area exists but the user can see none of it (so the
// caller emits 403 rather than silently 200-empty).
async function effectiveVillages(
  db: D1Database,
  scopeVillageIds: number[],
  level: GeoLevel,
  id: number | null,
): Promise<number[] | 'out_of_scope'> {
  const area = await villagesUnder(db, level, id);
  if (level === 'india') {
    return scopeVillageIds.filter((v) => area.includes(v));
  }
  if (area.length === 0) return [];
  const scopeSet = new Set(scopeVillageIds);
  const intersection = area.filter((v) => scopeSet.has(v));
  if (intersection.length === 0) return 'out_of_scope';
  return intersection;
}

async function buildDrillDown(
  db: D1Database,
  scopeVillageIds: number[],
  metric: Metric,
  level: GeoLevel,
  id: number | null,
  period: { from: string; to: string },
): Promise<DrillResult | { status: 403 | 404; message: string }> {
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
    return {
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
  }

  // Aggregate at child level.
  switch (metric) {
    case 'children': {
      const agg = await aggregateForChildren(db, effective, childLevel);
      return {
        metric, level, id, crumbs, child_level: childLevel,
        headers: [capLabel(childLevel), 'Children'],
        rows: agg.map((r) => [r.name, r.value]),
        drill_ids: agg.map((r) => r.id),
        period: null,
      };
    }
    case 'vc': {
      const agg = await aggregateForVc(db, effective, childLevel);
      return {
        metric, level, id, crumbs, child_level: childLevel,
        headers: [capLabel(childLevel), 'VCs'],
        rows: agg.map((r) => [r.name, r.value]),
        drill_ids: agg.map((r) => r.id),
        period: null,
      };
    }
    case 'af': {
      const agg = await aggregateForAf(db, effective, childLevel);
      return {
        metric, level, id, crumbs, child_level: childLevel,
        headers: [capLabel(childLevel), 'AFs'],
        rows: agg.map((r) => [r.name, r.value]),
        drill_ids: agg.map((r) => r.id),
        period: null,
      };
    }
    case 'attendance': {
      const agg = await aggregateForAttendance(db, effective, childLevel, period.from, period.to);
      return {
        metric, level, id, crumbs, child_level: childLevel,
        headers: [capLabel(childLevel), 'Attendance %', 'Present/Marked'],
        rows: agg.map((r) => [r.name, r.value, r.extra]),
        drill_ids: agg.map((r) => r.id),
        period: reportedPeriod,
      };
    }
    case 'achievements': {
      const agg = await aggregateForAchievements(db, effective, childLevel, period.from, period.to);
      return {
        metric, level, id, crumbs, child_level: childLevel,
        headers: [capLabel(childLevel), 'Total', 'SoM', 'Gold', 'Silver'],
        rows: agg.map((r) => [r.name, r.value, r.som, r.gold, r.silver]),
        drill_ids: agg.map((r) => r.id),
        period: reportedPeriod,
      };
    }
  }
}

function capLabel(level: GeoLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

// ---- routes -------------------------------------------------------

dashboard.get('/drilldown', requireCap('dashboard.read'), async (c) => {
  const user = c.get('user');
  const metricParam = c.req.query('metric');
  if (!isMetric(metricParam)) {
    return err(c, 'bad_request', 400, `metric must be one of ${METRICS.join('|')}`);
  }
  const levelParsed = parseLevelAndId(c.req.query('level'), c.req.query('id'));
  if ('error' in levelParsed) return err(c, 'bad_request', 400, levelParsed.error);
  const periodParsed = parsePeriod(c.req.query('from'), c.req.query('to'));
  if ('error' in periodParsed) return err(c, 'bad_request', 400, periodParsed.error);

  const scope = await villageIdsInScope(c.env.DB, user);
  const result = await buildDrillDown(
    c.env.DB, scope, metricParam, levelParsed.level, levelParsed.id, periodParsed,
  );
  if ('status' in result) {
    return err(c,
      result.status === 403 ? 'forbidden' : 'not_found',
      result.status,
      result.message,
    );
  }
  return c.json(result);
});

dashboard.get('/drilldown.csv', requireCap('dashboard.read'), async (c) => {
  const user = c.get('user');
  const metricParam = c.req.query('metric');
  if (!isMetric(metricParam)) {
    return err(c, 'bad_request', 400, `metric must be one of ${METRICS.join('|')}`);
  }
  const levelParsed = parseLevelAndId(c.req.query('level'), c.req.query('id'));
  if ('error' in levelParsed) return err(c, 'bad_request', 400, levelParsed.error);
  const periodParsed = parsePeriod(c.req.query('from'), c.req.query('to'));
  if ('error' in periodParsed) return err(c, 'bad_request', 400, periodParsed.error);

  const scope = await villageIdsInScope(c.env.DB, user);
  const result = await buildDrillDown(
    c.env.DB, scope, metricParam, levelParsed.level, levelParsed.id, periodParsed,
  );
  if ('status' in result) {
    return err(c,
      result.status === 403 ? 'forbidden' : 'not_found',
      result.status,
      result.message,
    );
  }

  const trailName = result.crumbs.map((c) => c.name).join(' > ');
  const filenameBase = `${metricParam}_${result.level}_${result.crumbs.at(-1)?.name ?? 'root'}`;
  const csv = toCsv(result.headers, result.rows);
  // Prepend a tiny context header so an exported CSV is self-describing
  // (spec §3.6.3: "CSV mirrors the on-screen table"; the trail is
  // the only on-screen context not otherwise captured).
  const contextLine = `# ${trailName}`
    + (result.period ? ` | ${result.period.from} to ${result.period.to}` : '')
    + '\r\n';
  return new Response(contextLine + csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFilename(filenameBase)}"`,
    },
  });
});

export default dashboard;
