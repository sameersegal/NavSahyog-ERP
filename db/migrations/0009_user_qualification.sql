-- 0009_user_qualification — wire user → qualification (spec §4.3.1).
--
-- L3.1 shipped the qualification master with no live consumer; this
-- migration adds the FK column the spec already specified, so the
-- L3.1 user-create form has somewhere to write a picker selection.
-- Nullable: existing seeded users carry no qualification, and an
-- admin may not always know one when creating a row.
--
-- SQLite ALTER TABLE ADD COLUMN supports a REFERENCES clause when
-- the new column is nullable + has no DEFAULT, so no table rebuild
-- is needed.

PRAGMA foreign_keys = ON;

ALTER TABLE user ADD COLUMN qualification_id INTEGER REFERENCES qualification(id);
