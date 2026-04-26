import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { villageIdsInScope } from '../scope';
import { err } from '../lib/errors';
import type { Bindings, Variables } from '../types';

type VillageRow = {
  id: number;
  name: string;
  code: string;
  cluster_id: number;
  cluster_name: string;
  coordinator_name: string | null;
};

type AdminRow = {
  id: number;
  name: string;
  code: string;
  cluster_id: number;
};

type AdminBody = {
  name?: string;
  code?: string;
  cluster_id?: number;
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

// L3.1 Master Creations (decisions.md D21–D22). Admin list bypasses
// the scope filter on GET / above — Super Admin lists every village,
// not just the ones in their scope. `requireCap('village.write')`
// gates this to super_admin per §2.3.
villages.get('/admin', requireCap('village.write'), async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.code, v.cluster_id
     FROM village v
     ORDER BY v.name COLLATE NOCASE`,
  ).all<AdminRow>();
  return c.json({ villages: rs.results });
});

function parseAdminBody(body: AdminBody): AdminRow | { error: string } {
  const name = (body.name ?? '').toString().trim();
  const code = (body.code ?? '').toString().trim();
  const clusterId = Number(body.cluster_id);
  if (!name) return { error: 'name required' };
  if (!code) return { error: 'code required' };
  if (!Number.isInteger(clusterId) || clusterId <= 0) {
    return { error: 'cluster_id must be a positive integer' };
  }
  return { id: 0, name, code, cluster_id: clusterId };
}

villages.post('/', requireCap('village.write'), async (c) => {
  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);
  const parsed = parseAdminBody(body);
  if ('error' in parsed) return err(c, 'bad_request', 400, parsed.error);
  const cluster = await c.env.DB.prepare('SELECT id FROM cluster WHERE id = ?')
    .bind(parsed.cluster_id)
    .first<{ id: number }>();
  if (!cluster) return err(c, 'bad_request', 400, 'unknown cluster_id');
  // Unique violations on `code` surface from SQLite as a generic
  // constraint error — pre-check so the client gets a structured 409.
  const existing = await c.env.DB.prepare('SELECT id FROM village WHERE code = ?')
    .bind(parsed.code)
    .first<{ id: number }>();
  if (existing) return err(c, 'conflict', 409, 'village code already exists');
  const rs = await c.env.DB.prepare(
    'INSERT INTO village (cluster_id, name, code) VALUES (?, ?, ?) RETURNING id',
  )
    .bind(parsed.cluster_id, parsed.name, parsed.code)
    .first<{ id: number }>();
  if (!rs) return err(c, 'internal_error', 500, 'insert failed');
  return c.json({ village: { ...parsed, id: rs.id } }, 201);
});

villages.patch('/:id', requireCap('village.write'), async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const existing = await c.env.DB.prepare(
    'SELECT id, name, code, cluster_id FROM village WHERE id = ?',
  )
    .bind(id)
    .first<AdminRow>();
  if (!existing) return err(c, 'not_found', 404);
  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);
  const name = body.name !== undefined ? body.name.toString().trim() : existing.name;
  const code = body.code !== undefined ? body.code.toString().trim() : existing.code;
  const clusterId = body.cluster_id !== undefined ? Number(body.cluster_id) : existing.cluster_id;
  if (!name) return err(c, 'bad_request', 400, 'name required');
  if (!code) return err(c, 'bad_request', 400, 'code required');
  if (!Number.isInteger(clusterId) || clusterId <= 0) {
    return err(c, 'bad_request', 400, 'cluster_id must be a positive integer');
  }
  if (clusterId !== existing.cluster_id) {
    const cluster = await c.env.DB.prepare('SELECT id FROM cluster WHERE id = ?')
      .bind(clusterId)
      .first<{ id: number }>();
    if (!cluster) return err(c, 'bad_request', 400, 'unknown cluster_id');
  }
  if (code !== existing.code) {
    const conflict = await c.env.DB
      .prepare('SELECT id FROM village WHERE code = ? AND id != ?')
      .bind(code, id)
      .first<{ id: number }>();
    if (conflict) return err(c, 'conflict', 409, 'village code already exists');
  }
  await c.env.DB
    .prepare('UPDATE village SET name = ?, code = ?, cluster_id = ? WHERE id = ?')
    .bind(name, code, clusterId, id)
    .run();
  return c.json({ village: { id, name, code, cluster_id: clusterId } });
});

export default villages;
