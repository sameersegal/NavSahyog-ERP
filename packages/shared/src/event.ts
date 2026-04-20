// Event wire shape — the JSON body returned by /api/events. Mirrors
// spec §4.3.4. `kind='event'` covers AC / Special Event; `kind='activity'`
// covers daily activities (Board Games, Running Race, …). See §3.4.2
// for the UI labels that map back off this flag.

export type EventKind = 'event' | 'activity';

export type Event = {
  id: number;
  name: string;
  kind: EventKind;
  description: string | null;
};

// Attendance session wire shape. One session = (village, date, event)
// per spec §4.3.5 UNIQUE. start_time / end_time are IST 'HH:MM' clock
// strings — see 0004_attendance_event.sql for the TEXT-over-INTEGER
// rationale.
export type AttendanceMark = { student_id: number; present: boolean };

export type AttendanceSession = {
  id: number;
  village_id: number;
  event_id: number;
  date: string;           // IST 'YYYY-MM-DD'
  start_time: string;     // IST 'HH:MM'
  end_time: string;       // IST 'HH:MM'
  voice_note_media_id: number | null;
};

// The GET /api/attendance payload: all sessions for a given
// (village, date) with their marks inlined. Clients never need to
// fetch marks separately for this view.
export type AttendanceSessionWithMarks = AttendanceSession & {
  event_name: string;
  event_kind: EventKind;
  marks: AttendanceMark[];
};
