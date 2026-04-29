import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { assertVillageInScope } from '../scope';
import { err } from '../lib/errors';
import type { Bindings, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

type School = { id: number; village_id: number; name: string };

type AdminRow = School & { village_name: string };

type AdminBody = {
  name?: string;
  village_id?: number;
};

// Walked by scripts/gen-matrix.mjs.
export const meta: RouteMeta = {
  context: 'masters',
  resource: 'schools',
  cra: 'create-only',
  offline: { write: 'online-only', read: 'online-only' },
  refs: ['§3.8.7'],
};

const schools = new Hono<{ Bindings: Bindings; Variables: Variables }>();

schools.use('*', requireAuth);

schools.get('/', requireCap('school.read'), async (c) => {
  const user = c.get('user');
  const villageId = Number(c.req.query('village_id'));
  if (!villageId) return err(c, 'bad_request', 400, 'village_id required');
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return err(c, 'forbidden', 403);
  }
  const rs = await c.env.DB.prepare(
    'SELECT id, village_id, name FROM school WHERE village_id = ? ORDER BY name',
  )
    .bind(villageId)
    .all<School>();
  return c.json({ schools: rs.results });
});

// L3.1 Master Creations (decisions.md D21–D22). Admin list returns
// every school across every village, with the village name joined
// for the picker. Gated to super_admin via `school.write`.
schools.get('/admin', requireCap('school.write'), async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT s.id, s.village_id, s.name, v.name AS village_name
     FROM school s JOIN village v ON v.id = s.village_id
     ORDER BY v.name COLLATE NOCASE, s.name COLLATE NOCASE`,
  ).all<AdminRow>();
  return c.json({ schools: rs.results });
});

function parseAdminBody(body: AdminBody): { name: string; village_id: number } | { error: string } {
  const name = (body.name ?? '').toString().trim();
  const villageId = Number(body.village_id);
  if (!name) return { error: 'name required' };
  if (!Number.isInteger(villageId) || villageId <= 0) {
    return { error: 'village_id must be a positive integer' };
  }
  return { name, village_id: villageId };
}

schools.post('/', requireCap('school.write'), async (c) => {
  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);
  const parsed = parseAdminBody(body);
  if ('error' in parsed) return err(c, 'bad_request', 400, parsed.error);
  const village = await c.env.DB.prepare('SELECT id FROM village WHERE id = ?')
    .bind(parsed.village_id)
    .first<{ id: number }>();
  if (!village) return err(c, 'bad_request', 400, 'unknown village_id');
  const rs = await c.env.DB.prepare(
    'INSERT INTO school (village_id, name) VALUES (?, ?) RETURNING id',
  )
    .bind(parsed.village_id, parsed.name)
    .first<{ id: number }>();
  if (!rs) return err(c, 'internal_error', 500, 'insert failed');
  return c.json({ school: { id: rs.id, village_id: parsed.village_id, name: parsed.name } }, 201);
});

schools.patch('/:id', requireCap('school.write'), async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const existing = await c.env.DB.prepare(
    'SELECT id, village_id, name FROM school WHERE id = ?',
  )
    .bind(id)
    .first<School>();
  if (!existing) return err(c, 'not_found', 404);
  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);
  const name = body.name !== undefined ? body.name.toString().trim() : existing.name;
  const villageId = body.village_id !== undefined ? Number(body.village_id) : existing.village_id;
  if (!name) return err(c, 'bad_request', 400, 'name required');
  if (!Number.isInteger(villageId) || villageId <= 0) {
    return err(c, 'bad_request', 400, 'village_id must be a positive integer');
  }
  if (villageId !== existing.village_id) {
    const village = await c.env.DB.prepare('SELECT id FROM village WHERE id = ?')
      .bind(villageId)
      .first<{ id: number }>();
    if (!village) return err(c, 'bad_request', 400, 'unknown village_id');
  }
  await c.env.DB
    .prepare('UPDATE school SET name = ?, village_id = ? WHERE id = ?')
    .bind(name, villageId, id)
    .run();
  return c.json({ school: { id, name, village_id: villageId } });
});

export default schools;
