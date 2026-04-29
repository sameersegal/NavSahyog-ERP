-- 0012_user_email — D36 self-heal support for /auth/exchange.
--
-- Adds the email column the exchange endpoint will consult when a
-- Clerk JWT arrives but no local row carries the matching
-- `clerk_user_id` (webhook hasn't fired, or Clerk account was
-- created out-of-band against a pre-existing local user). The
-- self-heal looks up the local user by email, sets `clerk_user_id`
-- + `clerk_synced_at`, then mints the session — first sign-in
-- works without depending on webhook delivery timing.
--
-- Nullable on purpose: pre-D36 rows (the test fixtures, the seed
-- users before the seed-bridge step backfills them) keep loading
-- with NULL. UNIQUE-when-non-null prevents two local users from
-- claiming the same Clerk identity at link time.

PRAGMA foreign_keys = ON;

ALTER TABLE user ADD COLUMN email TEXT;

CREATE UNIQUE INDEX idx_user_email
  ON user(email)
  WHERE email IS NOT NULL;
