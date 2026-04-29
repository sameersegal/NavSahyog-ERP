// Idempotency-Key dedupe for offline-eligible mutations (§5.1, L4.1a).
//
// Wraps a route handler so a replay of the same `Idempotency-Key`
// (from the outbox runner — packages/shared/src/sync.ts ulid)
// returns the prior response verbatim instead of running the
// handler again. Backed by the `idempotency_key` D1 table
// (db/migrations/0011_idempotency.sql).
//
// Why D1 and not KV (the §5.1 written plan): KV needs an operator
// binding; D1 is already wired and the load is bounded. Revisit if
// the table footprint grows past lab-scale.

import type { Context } from 'hono';
import type { Bindings, Variables } from '../types';

const RETENTION_MS = 24 * 60 * 60 * 1000; // §5.1 — 24h replay window.

type StoredResponse = {
  status: number;
  body: unknown;
};

type IdempotencyRow = {
  key: string;
  user_id: number;
  method: string;
  path: string;
  response_status: number;
  response_body: string;
  created_at: number;
};

// Look up an existing response for this (key, user, method, path).
// Returns null on miss or on an expired row (lazy GC — the row is
// not deleted here, just ignored; the sweep at the end of a write
// trims it).
async function lookup(
  db: D1Database,
  key: string,
  userId: number,
  method: string,
  path: string,
): Promise<StoredResponse | null> {
  const row = await db
    .prepare(
      `SELECT key, user_id, method, path,
              response_status, response_body, created_at
         FROM idempotency_key
        WHERE key = ? AND user_id = ? AND method = ? AND path = ?`,
    )
    .bind(key, userId, method, path)
    .first<IdempotencyRow>();
  if (!row) return null;
  if (Date.now() - row.created_at > RETENTION_MS) return null;
  return {
    status: row.response_status,
    body: JSON.parse(row.response_body) as unknown,
  };
}

async function store(
  db: D1Database,
  key: string,
  userId: number,
  method: string,
  path: string,
  status: number,
  body: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO idempotency_key
         (key, user_id, method, path, response_status, response_body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      key,
      userId,
      method,
      path,
      status,
      JSON.stringify(body),
      Date.now(),
    )
    .run();
}

// Lazy GC — keeps the table bounded without a scheduled job. Runs
// on each mutation, deletes anything past the 24h window.
async function gc(db: D1Database): Promise<void> {
  await db
    .prepare('DELETE FROM idempotency_key WHERE created_at < ?')
    .bind(Date.now() - RETENTION_MS)
    .run();
}

// Run `handler` exactly once per (Idempotency-Key, user, method,
// path). On a hit, returns the stored response with the prior
// status. On a miss, runs the handler, captures its JSON response,
// and stores it for the next replay.
//
// Handlers must return their result via `c.json(body, status)`.
// The wrapper unwraps that to `{ status, body }` for storage.
//
// Absent header → handler runs without dedupe (for direct API
// callers that don't go through the outbox).
type HandlerResult = { status: number; body: unknown };

export async function withIdempotency(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  handler: () => Promise<HandlerResult>,
): Promise<Response> {
  const key = c.req.header('Idempotency-Key');
  if (!key) {
    const out = await handler();
    return new Response(JSON.stringify(out.body), {
      status: out.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = c.get('user');
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;

  const cached = await lookup(c.env.DB, key, user.id, method, path);
  if (cached) {
    return new Response(JSON.stringify(cached.body), {
      status: cached.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const out = await handler();
  await store(c.env.DB, key, user.id, method, path, out.status, out.body);
  // Lazy GC — fire-and-forget would orphan errors; await is cheap
  // (a single DELETE per mutation, indexed) and bounded.
  await gc(c.env.DB);
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
