import { Hono } from 'hono';
import { requireAuth } from '../auth';
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

dashboard.get('/children', async (c) => {
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

dashboard.get('/attendance', async (c) => {
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
  const rs = await c.env.DB.prepare(
    `SELECT s.village_id,
            SUM(CASE WHEN m.present = 1 THEN 1 ELSE 0 END) AS present_count,
            COUNT(m.id) AS total_count
     FROM attendance_session s
     JOIN attendance_mark m ON m.session_id = s.id
     WHERE s.village_id IN (${placeholders}) AND s.date = ?
     GROUP BY s.village_id`,
  )
    .bind(...ids, date)
    .all<{ village_id: number; present_count: number; total_count: number }>();
  const byVillage = new Map(
    rs.results.map((r) => [r.village_id, { present: r.present_count, total: r.total_count }]),
  );
  return c.json({
    date,
    villages: villages.map((v) => {
      const agg = byVillage.get(v.village_id);
      return {
        ...v,
        present: agg?.present ?? 0,
        total: agg?.total ?? 0,
        marked: agg !== undefined,
      };
    }),
  });
});

export default dashboard;
