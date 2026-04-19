import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { assertVillageInScope } from '../scope';
import type { Bindings, Variables } from '../types';

type Mark = { student_id: number; present: boolean };
type PostBody = { village_id?: number; date?: number; marks?: Mark[] };

const attendance = new Hono<{ Bindings: Bindings; Variables: Variables }>();

attendance.use('*', requireAuth);

function startOfUtcDay(epochSeconds: number): number {
  return Math.floor(epochSeconds / 86400) * 86400;
}

function todayUtc(): number {
  return startOfUtcDay(Math.floor(Date.now() / 1000));
}

attendance.get('/', async (c) => {
  const user = c.get('user');
  const villageId = Number(c.req.query('village_id'));
  const date = Number(c.req.query('date') ?? todayUtc());
  if (!villageId) return c.json({ error: 'village_id required' }, 400);
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return c.json({ error: 'forbidden' }, 403);
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
  const user = c.get('user');
  if (user.role === 'super_admin' || user.role === 'vc' || user.role === 'af' || user.role === 'cluster_admin') {
    // allowed per §2.3
  }
  const body = await c.req.json<PostBody>().catch(() => ({}) as PostBody);
  const villageId = body.village_id;
  const submittedDate = body.date ?? todayUtc();
  const marks = body.marks ?? [];
  if (!villageId || marks.length === 0) {
    return c.json({ error: 'village_id and marks required' }, 400);
  }
  // L1: today only.
  const date = startOfUtcDay(submittedDate);
  if (date !== todayUtc()) {
    return c.json({ error: 'L1 allows attendance for today only' }, 400);
  }
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return c.json({ error: 'forbidden' }, 403);
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
    return c.json({ error: 'some students not in village or graduated' }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO attendance_session (village_id, date, created_at, created_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(village_id, date) DO UPDATE SET created_at = excluded.created_at,
         created_by = excluded.created_by`,
    ).bind(villageId, date, now, user.id),
  );
  await c.env.DB.batch(stmts);
  const session = await c.env.DB.prepare(
    'SELECT id FROM attendance_session WHERE village_id = ? AND date = ?',
  )
    .bind(villageId, date)
    .first<{ id: number }>();
  if (!session) return c.json({ error: 'session not created' }, 500);
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
