-- 0011_idempotency — server-side idempotency-key dedupe (§5.1, L4.1a).
--
-- Every offline-eligible mutation carries a client-generated
-- `Idempotency-Key` header (a ULID, sourced from the outbox row).
-- The server stores the response keyed by this key for 24h so a
-- replayed mutation returns the prior response verbatim instead of
-- creating a duplicate row. SoM achievements are inherently
-- idempotent on `(student, year-month)`, but gold/silver are not —
-- a retry without dedupe would create two rows.
--
-- Why D1 and not KV (the §5.1 plan): KV needs an operator binding
-- and a deploy-time wrangler.toml change. D1 is already wired and
-- the load is bounded — at most ~100 outbox rows per device per
-- 24h, with the §6.5 backoff schedule capping retries at 5. The
-- whole table is ~10 KB on a busy day.
--
-- Cleanup: rows older than 24h are pruned lazily by the next write
-- that lands on the same key, plus a sweep at the end of every
-- mutation handler. There's no scheduled job — this stays simple
-- until either (a) load grows enough to warrant KV, or (b) we move
-- to the §5.1 KV-based plan.

CREATE TABLE idempotency_key (
  -- The Idempotency-Key header value. Always a ULID in practice
  -- (outbox rows generate them), but stored as TEXT to accept any
  -- §5.1-conformant key.
  key TEXT PRIMARY KEY,

  -- Authoring user — same key from a different user replays as a
  -- fresh request (§5.1 implies user-scoped keys; making it
  -- explicit avoids a cross-user replay being accepted).
  user_id INTEGER NOT NULL,

  -- HTTP method + path the original request targeted. A replay
  -- against a different (method, path) is treated as a fresh
  -- request — keys are not portable across endpoints.
  method TEXT NOT NULL,
  path TEXT NOT NULL,

  -- HTTP status code of the original response (e.g. 201, 200, 409).
  response_status INTEGER NOT NULL,

  -- JSON body of the original response, stored as TEXT. The handler
  -- replays this verbatim with the same status. Body shape is the
  -- handler's contract; this table doesn't peek inside.
  response_body TEXT NOT NULL,

  -- ms epoch when the row was written. The lazy sweep prunes rows
  -- older than 24h on every mutation that reaches the table.
  created_at INTEGER NOT NULL
);

CREATE INDEX ix_idempotency_created_at ON idempotency_key (created_at);
