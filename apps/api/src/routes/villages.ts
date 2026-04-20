import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { villageIdsInScope } from '../scope';
import type { Bindings, Variables } from '../types';

type VillageRow = {
  id: number;
  name: string;
  code: string;
  cluster_id: number;
  cluster_name: string;
  coordinator_name: string | null;
};

const villages = new Hono<{ Bindings: Bindings; Variables: Variables }>();

villages.use('*', requireAuth);

// coordinator_name comes from the village-scoped VC user, if one is
// assigned. LEFT JOIN so the row survives when no VC exists yet —
// that's a valid state during onboarding and during role rotations.
// Multiple VCs on the same village (shouldn't happen, but nothing in
// the schema forbids it yet) resolve to the one with the lowest id,
// matching what every other list route does for deterministic order.
villages.get('/', requireCap('village.read'), async (c) => {
  const user = c.get('user');
  const ids = await villageIdsInScope(c.env.DB, user);
  if (ids.length === 0) return c.json({ villages: [] });
  const placeholders = ids.map(() => '?').join(',');
  const rs = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.code, v.cluster_id, c.name AS cluster_name,
            (
              SELECT u.full_name FROM user u
               WHERE u.role = 'vc'
                 AND u.scope_level = 'village'
                 AND u.scope_id = v.id
               ORDER BY u.id
               LIMIT 1
            ) AS coordinator_name
     FROM village v JOIN cluster c ON c.id = v.cluster_id
     WHERE v.id IN (${placeholders}) ORDER BY v.name`,
  )
    .bind(...ids)
    .all<VillageRow>();
  return c.json({ villages: rs.results });
});

export default villages;
