-- 0010_pond_agreement — Jal Vriddhi pond + farmer + agreement
-- versions (spec §3.10, §4.3.10). First non-child-development
-- workflow in the system. Numbered 0010 because main grew an
-- 0009_training_manual.sql in parallel (L3.1.1).
--
-- A VC creates a pond on a farmer's plot, captures GPS, and uploads
-- a signed agreement. Agreements are critical legal artefacts so we
-- keep every version: re-uploading creates a new row in
-- `pond_agreement_version` rather than overwriting the previous one.
-- The "current" agreement is `MAX(version) WHERE pond_id = ?`.
--
-- Why three tables and not one:
--   * `farmer` is a distinct entity — a farmer can have multiple
--     ponds over time and basic details (name, phone, plot label)
--     are mutable independently of any individual pond.
--   * `pond` is the asset — its identity is immutable, but status
--     and notes evolve.
--   * `pond_agreement_version` is the audit trail — append-only.
--
-- Scope: `farmer.village_id` is the canonical scope anchor. Both
-- `pond` and `pond_agreement_version` are reachable via that join,
-- so `assertVillageInScope()` against `farmer.village_id` covers all
-- three. `pond.village_id` is denormalised from `farmer.village_id`
-- for cheap list-in-scope filters; the application keeps them in
-- sync (farmers don't migrate villages — if that changes, the
-- denorm becomes a soft invariant covered by an integrity check).
--
-- R2 layout for agreement scans:
--   `agreement/{yyyy}/{mm}/{village_id}/{uuid}.{ext}`
-- Mirrors the media key shape (§7.1) so retention sweeps can
-- partition by date / village without joining D1. The `MEDIA` R2
-- binding is reused — single bucket, separate top-level prefix.
--
-- Allowed agreement MIMEs (app-enforced, not via CHECK constraint):
--   application/pdf, image/jpeg, image/png. Cap 25 MiB raw.
--
-- Time convention:
--   Instants (created_at, uploaded_at, deleted_at) are UTC epoch
--   seconds, matching every other instant column in this schema.

PRAGMA foreign_keys = ON;

-- Farmer columns:
--   phone            — canonical '+91XXXXXXXXXX', NULL if not collected.
--   plot_identifier  — free-text plot label (e.g. survey number),
--                      NULL when unknown.
CREATE TABLE farmer (
  id INTEGER PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES village(id),
  full_name TEXT NOT NULL,
  phone TEXT,
  plot_identifier TEXT,
  created_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES user(id),
  updated_at INTEGER,
  updated_by INTEGER REFERENCES user(id),
  deleted_at INTEGER,
  deleted_by INTEGER REFERENCES user(id)
);

CREATE INDEX idx_farmer_village ON farmer(village_id, deleted_at);

CREATE TABLE pond (
  id INTEGER PRIMARY KEY,
  farmer_id INTEGER NOT NULL REFERENCES farmer(id),
  village_id INTEGER NOT NULL REFERENCES village(id),
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'dug', 'active', 'inactive')),
  notes TEXT,
  created_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES user(id),
  updated_at INTEGER,
  updated_by INTEGER REFERENCES user(id),
  deleted_at INTEGER,
  deleted_by INTEGER REFERENCES user(id)
);

CREATE INDEX idx_pond_farmer ON pond(farmer_id);
CREATE INDEX idx_pond_village ON pond(village_id, deleted_at);
CREATE INDEX idx_pond_created ON pond(created_at);

-- pond_agreement_version columns:
--   version            — monotonic per pond, starting at 1.
--   uuid               — UUIDv4, also tail of R2 key.
--   original_filename  — as supplied by client, NULL if not provided.
--   notes              — "what changed", max 200 chars (app-enforced).
CREATE TABLE pond_agreement_version (
  id INTEGER PRIMARY KEY,
  pond_id INTEGER NOT NULL REFERENCES pond(id),
  version INTEGER NOT NULL,
  uuid TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  original_filename TEXT,
  notes TEXT,
  uploaded_at INTEGER NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES user(id),
  UNIQUE(pond_id, version)
);

CREATE INDEX idx_agreement_pond_version ON pond_agreement_version(pond_id, version);
