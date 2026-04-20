import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { villageIdsInScope } from '../scope';
import { isIsoDate, todayIstDate } from '../lib/time';
import { err } from '../lib/errors';
import type { Bindings, Variables } from '../types';

type VillageRow = {
  village_id: number;
  village_name: string;
  cluster_id: number;
  cluster_name: string;
};

const dashboard = new Hono<{ Bindings: Bindings; Variables: Variables }>();

dashboard.use('*', requireAuth);

async function scopeVillages(
  db: D1Database,
  ids: number[],
): Promise<VillageRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT v.id AS village_id, v.name AS village_name,
              c.id AS cluster_id, c.name AS cluster_name
       FROM village v JOIN cluster c ON c.id = v.cluster_id
       WHERE v.id IN (${placeholders})
       ORDER BY c.name, v.name`,
    )
    .bind(...ids)
    .all<VillageRow>();
  return rs.results;
}

dashboard.get('/children', requireCap('dashboard.read'), async (c) => {
  const user = c.get('user');
  const ids = await villageIdsInScope(c.env.DB, user);
  const villages = await scopeVillages(c.env.DB, ids);
  if (ids.length === 0) return c.json({ clusters: [] });
  const placeholders = ids.map(() => '?').join(',');
  const counts = await c.env.DB.prepare(
    `SELECT village_id, COUNT(*) AS count FROM student
     WHERE village_id IN (${placeholders}) AND graduated_at IS NULL
     GROUP BY village_id`,
  )
    .bind(...ids)
    .all<{ village_id: number; count: number }>();
  const byVillage = new Map(counts.results.map((r) => [r.village_id, r.count]));
  return c.json({ villages: villages.map((v) => ({ ...v, count: byVillage.get(v.village_id) ?? 0 })) });
});

dashboard.get('/attendance', requireCap('dashboard.read'), async (c) => {
  const user = c.get('user');
  const dateParam = c.req.query('date');
  if (dateParam !== undefined && !isIsoDate(dateParam)) {
    return err(c, 'bad_request', 400, 'date must be YYYY-MM-DD');
  }
  const date = dateParam ?? todayIstDate();
  const ids = await villageIdsInScope(c.env.DB, user);
  const villages = await scopeVillages(c.env.DB, ids);
  if (ids.length === 0) return c.json({ villages: [], date });
  const placeholders = ids.map(() => '?').join(',');
  // With multiple sessions per (village, date) from L2.2, a student
  // present in any session counts once. `DISTINCT student_id` on the
  // numerator; denominator is distinct students marked across the
  // day (not the village's enrollment — that's a drill-down view).
  // `session_count` exposes how many events ran that day so the UI
  // can disambiguate "no attendance yet" from "one session only".
  const rs = await c.env.DB.prepare(
    `SELECT s.village_id,
            COUNT(DISTINCT CASE WHEN m.present = 1 THEN m.student_id END) AS present_count,
            COUNT(DISTINCT m.student_id) AS total_count,
            COUNT(DISTINCT s.id) AS session_count
     FROM attendance_session s
     LEFT JOIN attendance_mark m ON m.session_id = s.id
     WHERE s.village_id IN (${placeholders}) AND s.date = ?
     GROUP BY s.village_id`,
  )
    .bind(...ids, date)
    .all<{
      village_id: number;
      present_count: number;
      total_count: number;
      session_count: number;
    }>();
  const byVillage = new Map(
    rs.results.map((r) => [
      r.village_id,
      {
        present: r.present_count,
        total: r.total_count,
        sessions: r.session_count,
      },
    ]),
  );
  return c.json({
    date,
    villages: villages.map((v) => {
      const agg = byVillage.get(v.village_id);
      return {
        ...v,
        present: agg?.present ?? 0,
        total: agg?.total ?? 0,
        sessions: agg?.sessions ?? 0,
        marked: agg !== undefined,
      };
    }),
  });
});

export default dashboard;
