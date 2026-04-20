-- L1 schema. Subset of requirements §4.
-- Simplifications vs §4:
--   * No uuid columns yet (L2+).
--   * Plain-text passwords (L5 replaces with Argon2id).
--   * No soft-delete on most tables; only student.graduated_at exists.
--   * attendance_session has no event_id (L2 adds it).
--   * Sessions stored in D1, not KV (L5 moves to KV).

PRAGMA foreign_keys = ON;

CREATE TABLE zone (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE
);

CREATE TABLE state (
  id INTEGER PRIMARY KEY,
  zone_id INTEGER NOT NULL REFERENCES zone(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE
);

CREATE TABLE region (
  id INTEGER PRIMARY KEY,
  state_id INTEGER NOT NULL REFERENCES state(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE
);

CREATE TABLE district (
  id INTEGER PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES region(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE
);

CREATE TABLE cluster (
  id INTEGER PRIMARY KEY,
  district_id INTEGER NOT NULL REFERENCES district(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE
);

CREATE TABLE village (
  id INTEGER PRIMARY KEY,
  cluster_id INTEGER NOT NULL REFERENCES cluster(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_state_zone ON state(zone_id);
CREATE INDEX idx_region_state ON region(state_id);
CREATE INDEX idx_district_region ON district(region_id);
CREATE INDEX idx_cluster_district ON cluster(district_id);
CREATE INDEX idx_village_cluster ON village(cluster_id);

CREATE TABLE user (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('vc','af','cluster_admin','super_admin')),
  scope_level TEXT NOT NULL CHECK (scope_level IN ('village','cluster','global')),
  scope_id INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_user_scope ON user(scope_level, scope_id);

CREATE TABLE session (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES user(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_session_user ON session(user_id);

CREATE TABLE school (
  id INTEGER PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES village(id),
  name TEXT NOT NULL
);

CREATE INDEX idx_school_village ON school(village_id);

CREATE TABLE student (
  id INTEGER PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES village(id),
  school_id INTEGER NOT NULL REFERENCES school(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('m','f','o')),
  dob INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  graduated_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES user(id)
);

CREATE INDEX idx_student_village ON student(village_id);
CREATE INDEX idx_student_school ON student(school_id);

CREATE TABLE attendance_session (
  id INTEGER PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES village(id),
  date INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES user(id),
  UNIQUE(village_id, date)
);

CREATE TABLE attendance_mark (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES attendance_session(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES student(id),
  present INTEGER NOT NULL CHECK (present IN (0,1)),
  UNIQUE(session_id, student_id)
);

CREATE INDEX idx_attendance_mark_session ON attendance_mark(session_id);
