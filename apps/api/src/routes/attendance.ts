import { Hono } from 'hono';
import {
  isClockTime,
  type AttendanceSessionWithMarks,
  type EventKind,
} from '@navsahyog/shared';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { assertVillageInScope } from '../scope';
import { err } from '../lib/errors';
import { isIsoDate, nowEpochSeconds, todayIstDate } from '../lib/time';
import type { Bindings, Variables } from '../types';

type Mark = { student_id: number; present: boolean };
type PostBody = {
  village_id?: number;
  event_id?: number;
  date?: string;
  start_time?: string;
  end_time?: string;
  marks?: Mark[];
};

type SessionRow = {
  id: number;
  village_id: number;
  event_id: number;
  event_name: string;
  event_kind: EventKind;
  date: string;
  start_time: string;
  end_time: string;
};

const attendance = new Hono<{ Bindings: Bindings; Variables: Variables }>();

attendance.use('*', requireAuth);

// §3.3.1/§3.3.3: submissions accepted only for today, today-1, today-2.
// Returns null on acceptance, a reason string on rejection.
function windowReject(date: string): string | null {
  if (date === todayIstDate()) return null;
  const today = new Date(`${todayIstDate()}T00:00:00Z`);
  const target = new Date(`${date}T00:00:00Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((today.getTime() - target.getTime()) / dayMs);
  if (diffDays < 0) return 'date cannot be in the future';
  if (diffDays > 2) return 'date must be within the last 3 days (today, today-1, today-2)';
  return null;
}

attendance.get('/', requireCap('attendance.read'), async (c) => {
  const user = c.get('user');
  const villageId = Number(c.req.query('village_id'));
  const dateParam = c.req.query('date');
  const date = dateParam ?? todayIstDate();
  if (!villageId) return err(c, 'bad_request', 400, 'village_id required');
  if (dateParam !== undefined && !isIsoDate(dateParam)) {
    return err(c, 'bad_request', 400, 'date must be YYYY-MM-DD');
  }
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return err(c, 'forbidden', 403);
  }
  const sessions = await c.env.DB.prepare(
    `SELECT s.id, s.village_id, s.event_id, s.date, s.start_time, s.end_time,
            e.name AS event_name, e.kind AS event_kind
     FROM attendance_session s
     JOIN event e ON e.id = s.event_id
     WHERE s.village_id = ? AND s.date = ?
     ORDER BY s.start_time, s.id`,
  )
    .bind(villageId, date)
    .all<SessionRow>();
  if (sessions.results.length === 0) {
    return c.json({ date, sessions: [] });
  }
  const sessionIds = sessions.results.map((s) => s.id);
  const placeholders = sessionIds.map(() => '?').join(',');
  const marks = await c.env.DB.prepare(
    `SELECT session_id, student_id, present
     FROM attendance_mark
     WHERE session_id IN (${placeholders})`,
  )
    .bind(...sessionIds)
    .all<{ session_id: number; student_id: number; present: number }>();
  const marksBySession = new Map<number, Mark[]>();
  for (const m of marks.results) {
    const list = marksBySession.get(m.session_id) ?? [];
    list.push({ student_id: m.student_id, present: m.present === 1 });
    marksBySession.set(m.session_id, list);
  }
  const payload: AttendanceSessionWithMarks[] = sessions.results.map((s) => ({
    id: s.id,
    village_id: s.village_id,
    event_id: s.event_id,
    event_name: s.event_name,
    event_kind: s.event_kind,
    date: s.date,
    start_time: s.start_time,
    end_time: s.end_time,
    marks: marksBySession.get(s.id) ?? [],
  }));
  return c.json({ date, sessions: payload });
});

attendance.post('/', requireCap('attendance.write'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<PostBody>().catch(() => ({}) as PostBody);
  const villageId = body.village_id;
  const eventId = body.event_id;
  const date = body.date ?? todayIstDate();
  const marks = body.marks ?? [];
  const startTime = body.start_time;
  const endTime = body.end_time;
  if (!villageId || !eventId || marks.length === 0) {
    return err(
      c,
      'bad_request',
      400,
      'village_id, event_id, and marks required',
    );
  }
  if (!isIsoDate(date)) {
    return err(c, 'bad_request', 400, 'date must be YYYY-MM-DD');
  }
  const windowErr = windowReject(date);
  if (windowErr) return err(c, 'bad_request', 400, windowErr);
  if (!startTime || !isClockTime(startTime)) {
    return err(c, 'bad_request', 400, 'start_time must be HH:MM');
  }
  if (!endTime || !isClockTime(endTime)) {
    return err(c, 'bad_request', 400, 'end_time must be HH:MM');
  }
  // String comparison works because HH:MM is zero-padded 24h.
  if (endTime < startTime) {
    return err(c, 'bad_request', 400, 'end_time must be ≥ start_time');
  }
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return err(c, 'forbidden', 403);
  }
  const event = await c.env.DB.prepare('SELECT id FROM event WHERE id = ?')
    .bind(eventId)
    .first<{ id: number }>();
  if (!event) return err(c, 'bad_request', 400, 'unknown event_id');

  const studentIds = marks.map((m) => m.student_id);
  const placeholders = studentIds.map(() => '?').join(',');
  const valid = await c.env.DB.prepare(
    `SELECT id FROM student
     WHERE village_id = ? AND graduated_at IS NULL AND id IN (${placeholders})`,
  )
    .bind(villageId, ...studentIds)
    .all<{ id: number }>();
  const validIds = new Set(valid.results.map((r) => r.id));
  if (validIds.size !== studentIds.length) {
    return err(c, 'bad_request', 400, 'some students not in village or graduated');
  }
  const now = nowEpochSeconds();
  // UPSERT on (village_id, date, event_id). A resubmission for the
  // same (village, date, event) replaces the marks and bumps
  // updated_at/by — spec §3.3.3.
  const session = await c.env.DB.prepare(
    `INSERT INTO attendance_session
       (village_id, event_id, date, start_time, end_time,
        created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(village_id, date, event_id) DO UPDATE SET
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by
     RETURNING id`,
  )
    .bind(villageId, eventId, date, startTime, endTime, now, user.id, now, user.id)
    .first<{ id: number }>();
  if (!session) return err(c, 'internal_error', 500, 'session not created');
  const sessionId = session.id;
  const ops: D1PreparedStatement[] = [
    c.env.DB.prepare('DELETE FROM attendance_mark WHERE session_id = ?').bind(
      sessionId,
    ),
  ];
  for (const m of marks) {
    ops.push(
      c.env.DB.prepare(
        'INSERT INTO attendance_mark (session_id, student_id, present) VALUES (?, ?, ?)',
      ).bind(sessionId, m.student_id, m.present ? 1 : 0),
    );
  }
  await c.env.DB.batch(ops);
  return c.json({ session_id: sessionId, count: marks.length });
});

export default attendance;
