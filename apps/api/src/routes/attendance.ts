import { Hono } from 'hono';
import { requireAuth, requireRole } from '../auth';
import { assertVillageInScope } from '../scope';
import { err } from '../lib/errors';
import { istDayStart, todayIst } from '../lib/time';
import type { Bindings, Variables } from '../types';

type Mark = { student_id: number; present: boolean };
type PostBody = { village_id?: number; date?: number; marks?: Mark[] };

const attendance = new Hono<{ Bindings: Bindings; Variables: Variables }>();

attendance.use('*', requireAuth);

attendance.get('/', async (c) => {
  const user = c.get('user');
  const villageId = Number(c.req.query('village_id'));
  const date = Number(c.req.query('date') ?? todayIst());
  if (!villageId) return err(c, 'bad_request', 400, 'village_id required');
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return err(c, 'forbidden', 403);
  }
  const session = await c.env.DB.prepare(
    'SELECT id FROM attendance_session WHERE village_id = ? AND date = ?',
  )
    .bind(villageId, date)
    .first<{ id: number }>();
  if (!session) return c.json({ session: null, marks: [] });
  const marks = await c.env.DB.prepare(
    'SELECT student_id, present FROM attendance_mark WHERE session_id = ?',
  )
    .bind(session.id)
    .all<{ student_id: number; present: number }>();
  return c.json({
    session: { id: session.id, village_id: villageId, date },
    marks: marks.results.map((m) => ({
      student_id: m.student_id,
      present: m.present === 1,
    })),
  });
});

attendance.post('/', async (c) => {
  const denied = requireRole(c, ['vc', 'af', 'cluster_admin', 'super_admin']);
  if (denied) return denied;
  const user = c.get('user');
  const body = await c.req.json<PostBody>().catch(() => ({}) as PostBody);
  const villageId = body.village_id;
  const submittedDate = body.date ?? todayIst();
  const marks = body.marks ?? [];
  if (!villageId || marks.length === 0) {
    return err(c, 'bad_request', 400, 'village_id and marks required');
  }
  // L1: today only.
  const date = istDayStart(submittedDate);
  if (date !== todayIst()) {
    return err(c, 'bad_request', 400, 'L1 allows attendance for today only');
  }
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return err(c, 'forbidden', 403);
  }
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
  const now = Math.floor(Date.now() / 1000);
  // INSERT-or-UPDATE the session and capture its id in one round-trip.
  // ON CONFLICT bumps created_at/created_by so the UNIQUE row is
  // returned either way.
  const session = await c.env.DB.prepare(
    `INSERT INTO attendance_session (village_id, date, created_at, created_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(village_id, date) DO UPDATE SET created_at = excluded.created_at,
       created_by = excluded.created_by
     RETURNING id`,
  )
    .bind(villageId, date, now, user.id)
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
