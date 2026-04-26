-- 0009_training_manual — read-only training-manuals master.
--
-- Field staff need a single place to find training manuals (PDF
-- handouts, videos linked from Drive, walkthrough docs). The
-- catalogue is authored by Super Admin via Master Creations and
-- read by every authenticated role from a dedicated nav entry.
-- Storage is link-only (`link TEXT`) — actual files live wherever
-- the operator already keeps them (Drive, Notion, the NavSahyog
-- website). We do not host the assets.
--
-- Time convention matches the rest of the schema: created_at /
-- updated_at are UTC epoch seconds. updated_at is surfaced on the
-- read-only page so users can see when a manual last changed.
-- (created_at and audit columns are not surfaced; they exist for
-- audit parity with other masters.)
--
-- UNIQUE (category, name): two manuals can share a name across
-- different categories, but never within one. Prevents the
-- accidentally-duplicated "Onboarding" row in two clicks.

PRAGMA foreign_keys = ON;

CREATE TABLE training_manual (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  link TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES user(id),
  updated_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES user(id),
  UNIQUE (category, name)
);

CREATE INDEX idx_training_manual_category
  ON training_manual(category COLLATE NOCASE, name COLLATE NOCASE);
