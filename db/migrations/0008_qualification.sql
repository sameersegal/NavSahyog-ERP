-- 0008_qualification — L3.1 Master Creations qualification table
-- (spec §3.8.7, decisions.md D21).
--
-- Lookup of qualifications a user can carry — used today only by
-- the Master-Creations admin screen so the picker has stable rows.
-- The table existed implicitly as a vendor-app concept; pulling it
-- into the schema here so the L3.1 admin surface has somewhere to
-- write. No FK consumer yet — when achievements / users start
-- referencing qualification_id, the FK is added in a follow-on
-- migration.
--
-- Time convention: created_at is UTC epoch seconds (same as every
-- other instant column in this schema).

PRAGMA foreign_keys = ON;

CREATE TABLE qualification (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES user(id)
);
