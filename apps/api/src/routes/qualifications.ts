import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { err } from '../lib/errors';
import { nowEpochSeconds } from '../lib/time';
import type { Bindings, Variables } from '../types';

const MAX_DESCRIPTION_LEN = 500;

type Qualification = {
  id: number;
  name: string;
  description: string | null;
};

type AdminBody = {
  name?: string;
  description?: string | null;
};

const qualifications = new Hono<{ Bindings: Bindings; Variables: Variables }>();

qualifications.use('*', requireAuth);

// Admin-only master, no non-admin consumer yet — gating list +
// writes on `qualification.write` is the simpler path until a
// reader emerges. See decisions.md D22.
qualifications.get('/', requireCap('qualification.write'), async (c) => {
  const rs = await c.env.DB.prepare(
    'SELECT id, name, description FROM qualification ORDER BY name COLLATE NOCASE',
  ).all<Qualification>();
  return c.json({ qualifications: rs.results });
});

function parseAdminBody(
  body: AdminBody,
): { name: string; description: string | null } | { error: string } {
  const name = (body.name ?? '').toString().trim();
  if (!name) return { error: 'name required' };
  let description: string | null = null;
  if (body.description !== undefined && body.description !== null) {
    description = body.description.toString().trim() || null;
    if (description && description.length > MAX_DESCRIPTION_LEN) {
      return { error: `description exceeds ${MAX_DESCRIPTION_LEN} chars` };
    }
  }
  return { name, description };
}

qualifications.post('/', requireCap('qualification.write'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);
  const parsed = parseAdminBody(body);
  if ('error' in parsed) return err(c, 'bad_request', 400, parsed.error);
  const conflict = await c.env.DB
    .prepare('SELECT id FROM qualification WHERE name = ?')
    .bind(parsed.name)
    .first<{ id: number }>();
  if (conflict) return err(c, 'conflict', 409, 'qualification name already exists');
  const now = nowEpochSeconds();
  const rs = await c.env.DB.prepare(
    `INSERT INTO qualification (name, description, created_at, created_by)
     VALUES (?, ?, ?, ?) RETURNING id`,
  )
    .bind(parsed.name, parsed.description, now, user.id)
    .first<{ id: number }>();
  if (!rs) return err(c, 'internal_error', 500, 'insert failed');
  return c.json(
    { qualification: { id: rs.id, name: parsed.name, description: parsed.description } },
    201,
  );
});

qualifications.patch('/:id', requireCap('qualification.write'), async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const existing = await c.env.DB
    .prepare('SELECT id, name, description FROM qualification WHERE id = ?')
    .bind(id)
    .first<Qualification>();
  if (!existing) return err(c, 'not_found', 404);
  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);
  const name = body.name !== undefined ? body.name.toString().trim() : existing.name;
  if (!name) return err(c, 'bad_request', 400, 'name required');
  let description: string | null = existing.description;
  if ('description' in body) {
    description = body.description === null || body.description === undefined
      ? null
      : (body.description.toString().trim() || null);
    if (description && description.length > MAX_DESCRIPTION_LEN) {
      return err(c, 'bad_request', 400, `description exceeds ${MAX_DESCRIPTION_LEN} chars`);
    }
  }
  if (name !== existing.name) {
    const conflict = await c.env.DB
      .prepare('SELECT id FROM qualification WHERE name = ? AND id != ?')
      .bind(name, id)
      .first<{ id: number }>();
    if (conflict) return err(c, 'conflict', 409, 'qualification name already exists');
  }
  await c.env.DB
    .prepare('UPDATE qualification SET name = ?, description = ? WHERE id = ?')
    .bind(name, description, id)
    .run();
  return c.json({ qualification: { id, name, description } });
});

export default qualifications;
