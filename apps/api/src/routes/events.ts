import { Hono } from 'hono';
import type { Event, EventKind } from '@navsahyog/shared';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { err } from '../lib/errors';
import { nowEpochSeconds } from '../lib/time';
import type { Bindings, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

const EVENT_KINDS: readonly EventKind[] = ['event', 'activity'];
const MAX_DESCRIPTION_LEN = 500;

type AdminBody = {
  name?: string;
  kind?: string;
  description?: string | null;
};

type AdminRow = Event & { reference_count: number; kind_locked: 0 | 1 };

// Walked by scripts/gen-matrix.mjs.
export const meta: RouteMeta = {
  context: 'masters',
  resource: 'events',
  cra: 'create-only',
  // Events are global master data, included in the offline manifest
  // (sync.ts) so the AttendanceForm picker reads them offline.
  offline: { write: 'online-only', read: 'cached' },
  refs: ['§3.8.7'],
};

const events = new Hono<{ Bindings: Bindings; Variables: Variables }>();

events.use('*', requireAuth);

// Events are single-tenant master data (§4.3.4). No scope filter —
// every role that can read events reads the full list; capability
// gating happens in the capability matrix, not here.
events.get('/', requireCap('event.read'), async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT id, name, kind, description
     FROM event
     ORDER BY kind, name COLLATE NOCASE`,
  ).all<Event>();
  return c.json({ events: rs.results });
});

// L3.1 Master Creations admin list — adds reference_count + kind_locked
// so the form can read-disable the `kind` field for events that have
// any media or attendance row pointing at them. Cheap correlated
// subqueries are fine; `event` is small (~tens of rows in the seed).
events.get('/admin', requireCap('event.write'), async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT
       e.id, e.name, e.kind, e.description,
       (
         (SELECT COUNT(*) FROM media WHERE tag_event_id = e.id AND deleted_at IS NULL) +
         (SELECT COUNT(*) FROM attendance_session WHERE event_id = e.id)
       ) AS reference_count
     FROM event e
     ORDER BY e.kind, e.name COLLATE NOCASE`,
  ).all<Event & { reference_count: number }>();
  const enriched: AdminRow[] = rs.results.map((row) => ({
    ...row,
    kind_locked: row.reference_count > 0 ? 1 : 0,
  }));
  return c.json({ events: enriched });
});

function parseKind(raw: unknown): EventKind | null {
  return typeof raw === 'string' && (EVENT_KINDS as readonly string[]).includes(raw)
    ? (raw as EventKind)
    : null;
}

function parseAdminBody(
  body: AdminBody,
): { name: string; kind: EventKind; description: string | null } | { error: string } {
  const name = (body.name ?? '').toString().trim();
  const kind = parseKind(body.kind);
  if (!name) return { error: 'name required' };
  if (!kind) return { error: 'kind must be event|activity' };
  let description: string | null = null;
  if (body.description !== undefined && body.description !== null) {
    description = body.description.toString().trim() || null;
    if (description && description.length > MAX_DESCRIPTION_LEN) {
      return { error: `description exceeds ${MAX_DESCRIPTION_LEN} chars` };
    }
  }
  return { name, kind, description };
}

events.post('/', requireCap('event.write'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);
  const parsed = parseAdminBody(body);
  if ('error' in parsed) return err(c, 'bad_request', 400, parsed.error);
  const now = nowEpochSeconds();
  const rs = await c.env.DB.prepare(
    `INSERT INTO event (name, kind, description, created_at, created_by)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(parsed.name, parsed.kind, parsed.description, now, user.id)
    .first<{ id: number }>();
  if (!rs) return err(c, 'internal_error', 500, 'insert failed');
  return c.json(
    { event: { id: rs.id, name: parsed.name, kind: parsed.kind, description: parsed.description } },
    201,
  );
});

// PATCH enforces the H5 immutability rule (review-findings v1):
// once any media or attendance row references the event, `kind` is
// frozen — flipping `event` ↔ `activity` would silently re-categorise
// historical data. Name and description stay editable.
events.patch('/:id', requireCap('event.write'), async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const existing = await c.env.DB
    .prepare('SELECT id, name, kind, description FROM event WHERE id = ?')
    .bind(id)
    .first<Event>();
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

  let kind: EventKind = existing.kind;
  if (body.kind !== undefined) {
    const parsedKind = parseKind(body.kind);
    if (!parsedKind) return err(c, 'bad_request', 400, 'kind must be event|activity');
    if (parsedKind !== existing.kind) {
      const refs = await c.env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM media WHERE tag_event_id = ? AND deleted_at IS NULL) +
           (SELECT COUNT(*) FROM attendance_session WHERE event_id = ?) AS n`,
      )
        .bind(id, id)
        .first<{ n: number }>();
      const count = refs?.n ?? 0;
      if (count > 0) {
        return err(
          c,
          'conflict',
          409,
          `event.kind frozen — has ${count} referencing rows`,
        );
      }
      kind = parsedKind;
    }
  }

  await c.env.DB
    .prepare('UPDATE event SET name = ?, kind = ?, description = ? WHERE id = ?')
    .bind(name, kind, description, id)
    .run();
  return c.json({ event: { id, name, kind, description } });
});

export default events;
