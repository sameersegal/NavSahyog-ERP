import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { err } from '../lib/errors';
import { nowEpochSeconds } from '../lib/time';
import type { Bindings, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

// Cap lengths to keep the picker rows readable. The link cap is
// generous enough to cover Drive + Notion URL shapes without
// admitting arbitrary blobs.
const MAX_NAME_LEN = 200;
const MAX_CATEGORY_LEN = 80;
const MAX_LINK_LEN = 1000;

type TrainingManual = {
  id: number;
  category: string;
  name: string;
  link: string;
  updated_at: number;
};

type AdminBody = {
  category?: string;
  name?: string;
  link?: string;
};

// Walked by scripts/gen-matrix.mjs.
export const meta: RouteMeta = {
  context: 'masters',
  resource: 'training_manuals',
  cra: 'create-only',
  offline: { write: 'online-only', read: 'online-only' },
  refs: ['§3.8.8'],
};

const trainingManuals = new Hono<{ Bindings: Bindings; Variables: Variables }>();

trainingManuals.use('*', requireAuth);

// Read is open to every authenticated role — every field user has a
// `training_manual.read` cap. Writes are gated to Super Admin via
// the SUPER_ADMIN_ONLY capability set.
trainingManuals.get('/', requireCap('training_manual.read'), async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT id, category, name, link, updated_at
     FROM training_manual
     ORDER BY category COLLATE NOCASE, name COLLATE NOCASE`,
  ).all<TrainingManual>();
  return c.json({ manuals: rs.results });
});

function parseLink(raw: string): string | { error: string } {
  // Accept http(s) only. Anything else (mailto:, javascript:, file:)
  // would point at a target the field user can't usefully open.
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: 'link must be an absolute URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'link must use http or https' };
  }
  return raw;
}

function parseAdminBody(
  body: AdminBody,
):
  | { category: string; name: string; link: string }
  | { error: string } {
  const category = (body.category ?? '').toString().trim();
  const name = (body.name ?? '').toString().trim();
  const linkRaw = (body.link ?? '').toString().trim();
  if (!category) return { error: 'category required' };
  if (!name) return { error: 'name required' };
  if (!linkRaw) return { error: 'link required' };
  if (category.length > MAX_CATEGORY_LEN) {
    return { error: `category exceeds ${MAX_CATEGORY_LEN} chars` };
  }
  if (name.length > MAX_NAME_LEN) {
    return { error: `name exceeds ${MAX_NAME_LEN} chars` };
  }
  if (linkRaw.length > MAX_LINK_LEN) {
    return { error: `link exceeds ${MAX_LINK_LEN} chars` };
  }
  const link = parseLink(linkRaw);
  if (typeof link !== 'string') return link;
  return { category, name, link };
}

trainingManuals.post('/', requireCap('training_manual.write'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);
  const parsed = parseAdminBody(body);
  if ('error' in parsed) return err(c, 'bad_request', 400, parsed.error);
  const conflict = await c.env.DB
    .prepare(
      'SELECT id FROM training_manual WHERE category = ? AND name = ?',
    )
    .bind(parsed.category, parsed.name)
    .first<{ id: number }>();
  if (conflict) {
    return err(c, 'conflict', 409, 'manual already exists in this category');
  }
  const now = nowEpochSeconds();
  const rs = await c.env.DB.prepare(
    `INSERT INTO training_manual
       (category, name, link, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(parsed.category, parsed.name, parsed.link, now, user.id, now, user.id)
    .first<{ id: number }>();
  if (!rs) return err(c, 'internal_error', 500, 'insert failed');
  return c.json(
    {
      manual: {
        id: rs.id,
        category: parsed.category,
        name: parsed.name,
        link: parsed.link,
        updated_at: now,
      },
    },
    201,
  );
});

trainingManuals.patch('/:id', requireCap('training_manual.write'), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const existing = await c.env.DB
    .prepare(
      'SELECT id, category, name, link FROM training_manual WHERE id = ?',
    )
    .bind(id)
    .first<{ id: number; category: string; name: string; link: string }>();
  if (!existing) return err(c, 'not_found', 404);

  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);
  const category =
    body.category !== undefined ? body.category.toString().trim() : existing.category;
  const name =
    body.name !== undefined ? body.name.toString().trim() : existing.name;
  const linkRaw =
    body.link !== undefined ? body.link.toString().trim() : existing.link;
  if (!category) return err(c, 'bad_request', 400, 'category required');
  if (!name) return err(c, 'bad_request', 400, 'name required');
  if (!linkRaw) return err(c, 'bad_request', 400, 'link required');
  if (category.length > MAX_CATEGORY_LEN) {
    return err(c, 'bad_request', 400, `category exceeds ${MAX_CATEGORY_LEN} chars`);
  }
  if (name.length > MAX_NAME_LEN) {
    return err(c, 'bad_request', 400, `name exceeds ${MAX_NAME_LEN} chars`);
  }
  if (linkRaw.length > MAX_LINK_LEN) {
    return err(c, 'bad_request', 400, `link exceeds ${MAX_LINK_LEN} chars`);
  }
  const linkOrErr = parseLink(linkRaw);
  if (typeof linkOrErr !== 'string') {
    return err(c, 'bad_request', 400, linkOrErr.error);
  }
  const link = linkOrErr;

  if (category !== existing.category || name !== existing.name) {
    const conflict = await c.env.DB
      .prepare(
        'SELECT id FROM training_manual WHERE category = ? AND name = ? AND id != ?',
      )
      .bind(category, name, id)
      .first<{ id: number }>();
    if (conflict) {
      return err(c, 'conflict', 409, 'manual already exists in this category');
    }
  }

  const now = nowEpochSeconds();
  await c.env.DB
    .prepare(
      `UPDATE training_manual
         SET category = ?, name = ?, link = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
    )
    .bind(category, name, link, now, user.id, id)
    .run();
  return c.json({
    manual: { id, category, name, link, updated_at: now },
  });
});

export default trainingManuals;
