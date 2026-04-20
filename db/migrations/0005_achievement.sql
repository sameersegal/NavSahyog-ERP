-- 0005_achievement — L2.3 achievements schema (spec §4.3.6).
--
-- One row per award. Three types: Star of the Month (som), Gold,
-- Silver. Gold/Silver carry a medal count (>= 1). SoM is description
-- only and is capped at one per (student, month) — a second SoM in
-- the same month replaces the first via UPSERT in the POST route.
--
-- Time convention:
--   date          TEXT 'YYYY-MM-DD' in IST (same as attendance).
--   created_at    INTEGER UTC epoch seconds.
--
-- SoM uniqueness: partial unique index over (student_id, YYYY-MM)
-- derived from date via substr(date, 1, 7). The predicate is
-- type = 'som' so gold/silver rows don't fight the constraint.

PRAGMA foreign_keys = ON;

CREATE TABLE achievement (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES student(id),
  description TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('som', 'gold', 'silver')),
  gold_count INTEGER CHECK (gold_count IS NULL OR gold_count >= 1),
  silver_count INTEGER CHECK (silver_count IS NULL OR silver_count >= 1),
  created_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES user(id),
  updated_at INTEGER,
  updated_by INTEGER REFERENCES user(id),
  CHECK ((type = 'som' AND gold_count IS NULL AND silver_count IS NULL) OR (type = 'gold' AND gold_count IS NOT NULL AND silver_count IS NULL) OR (type = 'silver' AND silver_count IS NOT NULL AND gold_count IS NULL))
);

CREATE INDEX idx_achievement_student ON achievement(student_id);
CREATE INDEX idx_achievement_date ON achievement(date);
CREATE INDEX idx_achievement_type ON achievement(type);

-- "One SoM per student per month" (§3.5, §4.3.6). Partial over
-- type='som' so gold/silver rows ignore the constraint.
CREATE UNIQUE INDEX uq_som_per_month
  ON achievement (student_id, substr(date, 1, 7))
  WHERE type = 'som';
