-- 0004_attendance_event — L2.2 attendance schema.
--
-- Changes vs 0001:
--   * Add `event` table (spec §4.3.4). One row per AC / Special Event
--     (kind='event') or daily activity (kind='activity'). Merged into
--     one table because the data shape is identical and the only UI
--     difference is the picker label — see review-findings-v1.md H5
--     for the immutability rule we're preserving here (app-level for
--     now; schema-level guard lands with the full audit-log work).
--   * Rebuild `attendance_session` to carry `event_id`, `start_time`,
--     `end_time`. The unique key widens from (village, date) to
--     (village, date, event_id) so a village can run multiple events
--     in one day.
--
-- Time-of-day convention: start_time / end_time use TEXT 'HH:MM' (IST
-- wall clock), same reasoning as date in 0001: a session time is a
-- clock reading on an IST calendar date, not a UTC instant. The spec
-- §4.3.5 had them as INTEGER epoch; we diverge deliberately for the
-- same reason we diverged on `date`.
--
-- attendance_mark rides on a CASCADE off attendance_session, so
-- dropping the old session table also clears its marks. This is
-- safe in the lab (no prod data); when real data exists we'll write
-- a data-migration step first.

PRAGMA foreign_keys = OFF;

CREATE TABLE event (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('event', 'activity')),
  description TEXT,
  created_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES user(id)
);

CREATE INDEX idx_event_kind ON event(kind);

-- Old L1 attendance rows carry no event_id; the seed drops the table
-- contents before reinserting. No attempt to preserve them.
DROP TABLE attendance_mark;
DROP TABLE attendance_session;

CREATE TABLE attendance_session (
  id INTEGER PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES village(id),
  event_id INTEGER NOT NULL REFERENCES event(id),
  date TEXT NOT NULL,                 -- IST 'YYYY-MM-DD'
  start_time TEXT NOT NULL,           -- IST 'HH:MM'
  end_time TEXT NOT NULL,             -- IST 'HH:MM'
  created_at INTEGER NOT NULL,        -- UTC epoch seconds
  created_by INTEGER NOT NULL REFERENCES user(id),
  updated_at INTEGER,
  updated_by INTEGER REFERENCES user(id),
  UNIQUE(village_id, date, event_id)
);

CREATE INDEX idx_attendance_session_village_date ON attendance_session(village_id, date);
CREATE INDEX idx_attendance_session_event ON attendance_session(event_id);

CREATE TABLE attendance_mark (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES attendance_session(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES student(id),
  present INTEGER NOT NULL CHECK (present IN (0, 1)),
  UNIQUE(session_id, student_id)
);

CREATE INDEX idx_attendance_mark_session ON attendance_mark(session_id);

PRAGMA foreign_key_check;

PRAGMA foreign_keys = ON;
