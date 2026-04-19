import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { assertVillageInScope } from '../scope';
import type { Bindings, Variables } from '../types';

type Student = {
  id: number;
  village_id: number;
  school_id: number;
  first_name: string;
  last_name: string;
  gender: 'm' | 'f' | 'o';
  dob: number;
  joined_at: number;
  graduated_at: number | null;
};

type AddBody = {
  village_id?: number;
  school_id?: number;
  first_name?: string;
  last_name?: string;
  gender?: 'm' | 'f' | 'o';
  dob?: number;
};

const children = new Hono<{ Bindings: Bindings; Variables: Variables }>();

children.use('*', requireAuth);

children.get('/', async (c) => {
  const user = c.get('user');
  const villageId = Number(c.req.query('village_id'));
  if (!villageId) return c.json({ error: 'village_id required' }, 400);
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const rs = await c.env.DB.prepare(
    `SELECT id, village_id, school_id, first_name, last_name, gender, dob,
            joined_at, graduated_at
     FROM student WHERE village_id = ? AND graduated_at IS NULL
     ORDER BY first_name, last_name`,
  )
    .bind(villageId)
    .all<Student>();
  return c.json({ children: rs.results });
});

children.post('/', async (c) => {
  const user = c.get('user');
  if (user.role === 'super_admin' || user.role === 'vc' || user.role === 'af' || user.role === 'cluster_admin') {
    // allowed — cluster_admin included per §2.3
  }
  const body = await c.req.json<AddBody>().catch(() => ({}) as AddBody);
  const { village_id, school_id, first_name, last_name, gender, dob } = body;
  if (!village_id || !school_id || !first_name || !last_name || !gender || !dob) {
    return c.json({ error: 'missing required fields' }, 400);
  }
  if (!['m', 'f', 'o'].includes(gender)) {
    return c.json({ error: 'invalid gender' }, 400);
  }
  if (!(await assertVillageInScope(c.env.DB, user, village_id))) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const school = await c.env.DB.prepare(
    'SELECT id FROM school WHERE id = ? AND village_id = ?',
  )
    .bind(school_id, village_id)
    .first<{ id: number }>();
  if (!school) return c.json({ error: 'school not in village' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const rs = await c.env.DB.prepare(
    `INSERT INTO student
       (village_id, school_id, first_name, last_name, gender, dob,
        joined_at, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  )
    .bind(
      village_id,
      school_id,
      first_name,
      last_name,
      gender,
      dob,
      now,
      now,
      user.id,
    )
    .first<{ id: number }>();
  return c.json({ id: rs?.id }, 201);
});

export default children;
