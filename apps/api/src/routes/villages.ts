import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { villageIdsInScope } from '../scope';
import type { Bindings, Variables } from '../types';

type VillageRow = {
  id: number;
  name: string;
  code: string;
  cluster_id: number;
  cluster_name: string;
};

const villages = new Hono<{ Bindings: Bindings; Variables: Variables }>();

villages.use('*', requireAuth);

villages.get('/', async (c) => {
  const user = c.get('user');
  const ids = await villageIdsInScope(c.env.DB, user);
  if (ids.length === 0) return c.json({ villages: [] });
  const placeholders = ids.map(() => '?').join(',');
  const rs = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.code, v.cluster_id, c.name AS cluster_name
     FROM village v JOIN cluster c ON c.id = v.cluster_id
     WHERE v.id IN (${placeholders}) ORDER BY v.name`,
  )
    .bind(...ids)
    .all<VillageRow>();
  return c.json({ villages: rs.results });
});

export default villages;
