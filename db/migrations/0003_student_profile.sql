-- 0003_student_profile — parent fields, alt contact, graduation
-- reason, and updated_at/by audit pair on `student`. Columns match
-- requirements §4.3.3 except for the Aadhaar-masked fields, which
-- are deferred to L5 (compliance + auth hardening) — the form
-- doesn't collect them in L2.
--
-- All new columns are nullable so existing L1 seed rows stay valid.
-- Application-level validation in children.ts enforces:
--   * at least one parent (father_name OR mother_name) on create;
--   * alt_contact_* required when neither parent has a smartphone.
-- Storing the rules in the app (not as NOT NULL / CHECK constraints)
-- keeps the migration backward-compatible with existing rows.
--
-- Photo (photo_media_id) and parent_aadhaar_masked land in later
-- migrations; see mvp/level-2.md L2.4 for media and mvp/level-5.md
-- for compliance.

ALTER TABLE student ADD COLUMN father_name TEXT;
ALTER TABLE student ADD COLUMN father_phone TEXT;
ALTER TABLE student ADD COLUMN father_has_smartphone INTEGER
  CHECK (father_has_smartphone IN (0, 1));

ALTER TABLE student ADD COLUMN mother_name TEXT;
ALTER TABLE student ADD COLUMN mother_phone TEXT;
ALTER TABLE student ADD COLUMN mother_has_smartphone INTEGER
  CHECK (mother_has_smartphone IN (0, 1));

ALTER TABLE student ADD COLUMN alt_contact_name TEXT;
ALTER TABLE student ADD COLUMN alt_contact_phone TEXT;
ALTER TABLE student ADD COLUMN alt_contact_relationship TEXT;

ALTER TABLE student ADD COLUMN graduation_reason TEXT
  CHECK (graduation_reason IN ('pass_out', 'other'));

ALTER TABLE student ADD COLUMN updated_at INTEGER;
ALTER TABLE student ADD COLUMN updated_by INTEGER REFERENCES user(id);
