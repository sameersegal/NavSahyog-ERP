import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { assertVillageInScope } from '../scope';
import type { Bindings, Variables } from '../types';

type School = { id: number; village_id: number; name: string };

const schools = new Hono<{ Bindings: Bindings; Variables: Variables }>();

schools.use('*', requireAuth);

schools.get('/', async (c) => {
  const user = c.get('user');
  const villageId = Number(c.req.query('village_id'));
  if (!villageId) return c.json({ error: 'village_id required' }, 400);
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const rs = await c.env.DB.prepare(
    'SELECT id, village_id, name FROM school WHERE village_id = ? ORDER BY name',
  )
    .bind(villageId)
    .all<School>();
  return c.json({ schools: rs.results });
});

export default schools;
