-- 0011_clerk_identity — D36 layer-1 (Clerk) ↔ layer-2 (Worker)
-- mapping. Adds the columns the `/auth/exchange` endpoint and the
-- `/webhooks/clerk` handler will write; everything else in the
-- `user` table is unchanged.
--
-- `clerk_user_id` is the Clerk-side identifier (e.g. `user_2abc…`).
-- Nullable so existing dummy seed users keep loading until the
-- step-5 seed bridge script back-fills them. UNIQUE so duplicate
-- webhook deliveries upsert rather than insert twice.
--
-- `clerk_synced_at` is the unix-seconds timestamp of the last
-- webhook (or self-heal) write that touched this row. The
-- `/auth/exchange` self-heal path uses it to decide whether to
-- re-fetch the Clerk user record on stale rows; the webhook
-- handler writes it on every upsert. NULL means "never synced
-- from Clerk" (i.e. legacy seed user).
--
-- The existing `password TEXT NOT NULL` column is **not** touched
-- here. It becomes vestigial once `/auth/login` is dropped in step
-- 4 of D36; new Clerk-provisioned users will be inserted with a
-- sentinel value (`''`) by the webhook / seed bridge. A later
-- migration drops the column once the new path has been live for
-- a release. Keeping it NOT NULL today preserves every FK and
-- avoids a table-rewrite in step 1.

PRAGMA foreign_keys = ON;

ALTER TABLE user ADD COLUMN clerk_user_id TEXT;
ALTER TABLE user ADD COLUMN clerk_synced_at INTEGER;

CREATE UNIQUE INDEX idx_user_clerk_user_id
  ON user(clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;
