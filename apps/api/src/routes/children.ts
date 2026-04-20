import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { assertVillageInScope } from '../scope';
import { err } from '../lib/errors';
import { isIsoDate, nowEpochSeconds, todayIstDate } from '../lib/time';
import type { Bindings, Variables } from '../types';

type Student = {
  id: number;
  village_id: number;
  school_id: number;
  first_name: string;
  last_name: string;
  gender: 'm' | 'f' | 'o';
  dob: string;
  joined_at: string;
  graduated_at: string | null;
};

type AddBody = {
  village_id?: number;
  school_id?: number;
  first_name?: string;
  last_name?: string;
  gender?: 'm' | 'f' | 'o';
  dob?: string;
};

const children = new Hono<{ Bindings: Bindings; Variables: Variables }>();

children.use('*', requireAuth);

children.get('/', requireCap('child.read'), async (c) => {
  const user = c.get('user');
  const villageId = Number(c.req.query('village_id'));
  if (!villageId) return err(c, 'bad_request', 400, 'village_id required');
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return err(c, 'forbidden', 403);
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

children.post('/', requireCap('child.write'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<AddBody>().catch(() => ({}) as AddBody);
  const { village_id, school_id, first_name, last_name, gender, dob } = body;
  if (!village_id || !school_id || !first_name || !last_name || !gender || !dob) {
    return err(c, 'bad_request', 400, 'missing required fields');
  }
  if (!['m', 'f', 'o'].includes(gender)) {
    return err(c, 'bad_request', 400, 'invalid gender');
  }
  if (!isIsoDate(dob)) {
    return err(c, 'bad_request', 400, 'dob must be YYYY-MM-DD');
  }
  if (!(await assertVillageInScope(c.env.DB, user, village_id))) {
    return err(c, 'forbidden', 403);
  }
  const school = await c.env.DB.prepare(
    'SELECT id FROM school WHERE id = ? AND village_id = ?',
  )
    .bind(school_id, village_id)
    .first<{ id: number }>();
  if (!school) return err(c, 'bad_request', 400, 'school not in village');
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
      todayIstDate(),
      nowEpochSeconds(),
      user.id,
    )
    .first<{ id: number }>();
  return c.json({ id: rs?.id }, 201);
});

export default children;
