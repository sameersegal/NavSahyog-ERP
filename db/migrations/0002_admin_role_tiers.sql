-- 0002_admin_role_tiers — widen user.role and user.scope_level CHECKs
-- to admit the four read-only geo-admin tiers introduced in L2.
--
-- SQLite cannot ALTER an existing CHECK, so we rebuild the `user`
-- table. The rebuild preserves rowids (id values), so every
-- session.user_id / student.created_by / attendance_session.created_by
-- FK survives the swap.
--
-- Added roles:        district_admin, region_admin, state_admin, zone_admin.
-- Added scope levels: district, region, state, zone.
--
-- All four new roles carry only `.read` capabilities in
-- packages/shared/src/capabilities.ts — the server's requireCap
-- middleware enforces §2.3 without any additional gates here.

PRAGMA foreign_keys = OFF;

CREATE TABLE user_new (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
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
    'village',
    'cluster',
    'district',
    'region',
    'state',
    'zone',
    'global'
  )),
  scope_id INTEGER,
  created_at INTEGER NOT NULL
);

INSERT INTO user_new (id, user_id, full_name, password, role, scope_level, scope_id, created_at)
SELECT id, user_id, full_name, password, role, scope_level, scope_id, created_at FROM user;

DROP TABLE user;

ALTER TABLE user_new RENAME TO user;

-- The DROP cascades the index; recreate it.
CREATE INDEX idx_user_scope ON user(scope_level, scope_id);

-- Standard SQLite 12-step: verify FKs resolve against the rebuilt
-- `user` table before re-enabling enforcement. A clean run returns
-- zero rows. Wrangler D1 migrations execute silently — surface any
-- violations by running this statement manually via `wrangler d1
-- execute --command 'PRAGMA foreign_key_check;'` after applying.
PRAGMA foreign_key_check;

PRAGMA foreign_keys = ON;
