import { Hono } from 'hono';
import type { Event } from '@navsahyog/shared';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import type { Bindings, Variables } from '../types';

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

export default events;
