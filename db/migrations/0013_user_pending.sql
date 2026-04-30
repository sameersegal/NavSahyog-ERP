-- 0013_user_pending — admit a `pending` role + scope_level so the
-- /webhooks/clerk user.created handler can INSERT a row before an
-- admin has assigned a real role/scope. Pending users carry no
-- capabilities (capabilities.ts maps `pending` → []) and resolve to
-- an empty village set in scope.ts (no `pending` entry in
-- VILLAGE_IDS_SQL → falls through to `return []`), so a freshly
-- provisioned row is sign-in-able but cannot read or write anything
-- until promoted via the Masters → Users surface.
--
-- SQLite cannot ALTER an existing CHECK, so we rebuild the table.
-- The rebuild preserves rowids (id values) and recreates every
-- index that 0001 / 0011 / 0012 added.

PRAGMA foreign_keys = OFF;

CREATE TABLE user_new (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'pending',
    'vc',
    'af',
    'cluster_admin',
    'district_admin',
    'region_admin',
    'state_admin',
    'zone_admin',
    'super_admin'
  )),
  scope_level TEXT NOT NULL CHECK (scope_level IN (
    'pending',
    'village',
    'cluster',
    'district',
    'region',
    'state',
    'zone',
    'global'
  )),
  scope_id INTEGER,
  created_at INTEGER NOT NULL,
  clerk_user_id TEXT,
  clerk_synced_at INTEGER,
  email TEXT
);

INSERT INTO user_new (
  id, user_id, full_name, password, role, scope_level, scope_id,
  created_at, clerk_user_id, clerk_synced_at, email
)
SELECT
  id, user_id, full_name, password, role, scope_level, scope_id,
  created_at, clerk_user_id, clerk_synced_at, email
FROM user;

DROP TABLE user;

ALTER TABLE user_new RENAME TO user;

CREATE INDEX idx_user_scope ON user(scope_level, scope_id);

CREATE UNIQUE INDEX idx_user_clerk_user_id
  ON user(clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

CREATE UNIQUE INDEX idx_user_email
  ON user(email)
  WHERE email IS NOT NULL;

PRAGMA foreign_key_check;

PRAGMA foreign_keys = ON;
