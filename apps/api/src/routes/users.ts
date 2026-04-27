import { Hono } from 'hono';
import { ROLES, type Role, type ScopeLevel } from '@navsahyog/shared';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { err } from '../lib/errors';
import { nowEpochSeconds } from '../lib/time';
import type { Bindings, Variables } from '../types';

// Role determines scope_level uniquely (every seed row follows this
// pattern, and the §2.3 matrix is structured the same way). Pinning
// it server-side means the form picks a role + a scope_id and we
// derive scope_level — fewer ways to construct an invalid row, and
// the create form doesn't need a 2-step level/role picker.
const SCOPE_FOR_ROLE: Record<Role, ScopeLevel> = {
  vc: 'village',
  af: 'cluster',
  cluster_admin: 'cluster',
  district_admin: 'district',
  region_admin: 'region',
  state_admin: 'state',
  zone_admin: 'zone',
  super_admin: 'global',
};

// Maps each non-global scope_level to the table whose id it
// references. Used to check the scope_id exists before insert.
const SCOPE_TABLE: Record<Exclude<ScopeLevel, 'global'>, string> = {
  village: 'village',
  cluster: 'cluster',
  district: 'district',
  region: 'region',
  state: 'state',
  zone: 'zone',
};

type AdminUser = {
  id: number;
  user_id: string;
  full_name: string;
  role: Role;
  scope_level: ScopeLevel;
  scope_id: number | null;
  scope_name: string | null;
  qualification_id: number | null;
  qualification_name: string | null;
};

type AdminBody = {
  user_id?: string;
  full_name?: string;
  role?: string;
  scope_id?: number | null;
  qualification_id?: number | null;
};

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>();

users.use('*', requireAuth);

function parseRole(raw: unknown): Role | null {
  return typeof raw === 'string' && (ROLES as readonly string[]).includes(raw)
    ? (raw as Role)
    : null;
}

// scope_name resolved per row by picking the right table from
// SCOPE_TABLE. Done with a CASE expression rather than seven LEFT
// JOINs so the query stays compact. qualification_name comes via
// LEFT JOIN so users with no qualification still surface as a row.
const SELECT_USER_COLUMNS = `
  u.id, u.user_id, u.full_name, u.role, u.scope_level, u.scope_id,
  CASE u.scope_level
    WHEN 'village'  THEN (SELECT name FROM village  WHERE id = u.scope_id)
    WHEN 'cluster'  THEN (SELECT name FROM cluster  WHERE id = u.scope_id)
    WHEN 'district' THEN (SELECT name FROM district WHERE id = u.scope_id)
    WHEN 'region'   THEN (SELECT name FROM region   WHERE id = u.scope_id)
    WHEN 'state'    THEN (SELECT name FROM state    WHERE id = u.scope_id)
    WHEN 'zone'     THEN (SELECT name FROM zone     WHERE id = u.scope_id)
    ELSE NULL
  END AS scope_name,
  u.qualification_id, q.name AS qualification_name
`;
const FROM_USER = `
  FROM user u
  LEFT JOIN qualification q ON q.id = u.qualification_id
`;

async function loadAdminUser(
  db: D1Database,
  id: number,
): Promise<AdminUser | null> {
  return (
    (await db
      .prepare(`SELECT ${SELECT_USER_COLUMNS} ${FROM_USER} WHERE u.id = ?`)
      .bind(id)
      .first<AdminUser>()) ?? null
  );
}

users.get('/', requireCap('user.write'), async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT ${SELECT_USER_COLUMNS} ${FROM_USER}
     ORDER BY u.role, u.full_name COLLATE NOCASE`,
  ).all<AdminUser>();
  return c.json({ users: rs.results });
});

type ParsedUser = {
  user_id: string;
  full_name: string;
  role: Role;
  scope_level: ScopeLevel;
  scope_id: number | null;
  qualification_id: number | null;
};

async function validateScope(
  db: D1Database,
  scopeLevel: ScopeLevel,
  scopeId: number | null,
): Promise<string | null> {
  if (scopeLevel === 'global') {
    if (scopeId !== null) return 'scope_id must be null for global scope';
    return null;
  }
  if (scopeId === null || !Number.isInteger(scopeId) || scopeId <= 0) {
    return 'scope_id required for non-global scope';
  }
  const table = SCOPE_TABLE[scopeLevel];
  const row = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ?`)
    .bind(scopeId)
    .first<{ id: number }>();
  if (!row) return `unknown ${scopeLevel} id`;
  return null;
}

function parseAdminBody(body: AdminBody): ParsedUser | { error: string } {
  const userId = (body.user_id ?? '').toString().trim();
  const fullName = (body.full_name ?? '').toString().trim();
  const role = parseRole(body.role);
  if (!userId) return { error: 'user_id required' };
  if (!fullName) return { error: 'full_name required' };
  if (!role) return { error: 'role must be one of the eight roles' };
  const scopeLevel = SCOPE_FOR_ROLE[role];
  let scopeId: number | null = null;
  if (scopeLevel === 'global') {
    if (body.scope_id !== undefined && body.scope_id !== null) {
      return { error: 'scope_id must be null for global scope' };
    }
  } else {
    const raw = body.scope_id;
    if (raw === undefined || raw === null) {
      return { error: 'scope_id required for non-global scope' };
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      return { error: 'scope_id must be a positive integer' };
    }
    scopeId = n;
  }
  // qualification_id is optional; null clears, undefined keeps existing
  // (handled in PATCH). Server validates existence in validateQualification.
  let qualificationId: number | null = null;
  if (body.qualification_id !== undefined && body.qualification_id !== null) {
    const n = Number(body.qualification_id);
    if (!Number.isInteger(n) || n <= 0) {
      return { error: 'qualification_id must be a positive integer or null' };
    }
    qualificationId = n;
  }
  return {
    user_id: userId,
    full_name: fullName,
    role,
    scope_level: scopeLevel,
    scope_id: scopeId,
    qualification_id: qualificationId,
  };
}

async function validateQualification(
  db: D1Database,
  id: number | null,
): Promise<string | null> {
  if (id === null) return null;
  const row = await db
    .prepare('SELECT id FROM qualification WHERE id = ?')
    .bind(id)
    .first<{ id: number }>();
  if (!row) return 'unknown qualification_id';
  return null;
}

// Lab default password matching the L1/L2 seed (decisions.md D24).
// The Master-Creations form intentionally has no password field —
// auth moves to Clerk in L5, and exposing a bring-your-own-password
// surface here would be ripped out wholesale at that point. New
// users sign in with this default; an out-of-band reset is the
// only path to a different value until Clerk lands.
const DEFAULT_PASSWORD = 'password';

users.post('/', requireCap('user.write'), async (c) => {
  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);
  const parsed = parseAdminBody(body);
  if ('error' in parsed) return err(c, 'bad_request', 400, parsed.error);
  const scopeError = await validateScope(c.env.DB, parsed.scope_level, parsed.scope_id);
  if (scopeError) return err(c, 'bad_request', 400, scopeError);
  const qualError = await validateQualification(c.env.DB, parsed.qualification_id);
  if (qualError) return err(c, 'bad_request', 400, qualError);

  const existing = await c.env.DB
    .prepare('SELECT id FROM user WHERE user_id = ?')
    .bind(parsed.user_id)
    .first<{ id: number }>();
  if (existing) return err(c, 'conflict', 409, 'user_id already exists');

  const now = nowEpochSeconds();
  const rs = await c.env.DB.prepare(
    `INSERT INTO user
       (user_id, full_name, password, role, scope_level, scope_id, qualification_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      parsed.user_id,
      parsed.full_name,
      DEFAULT_PASSWORD,
      parsed.role,
      parsed.scope_level,
      parsed.scope_id,
      parsed.qualification_id,
      now,
    )
    .first<{ id: number }>();
  if (!rs) return err(c, 'internal_error', 500, 'insert failed');
  const fresh = await loadAdminUser(c.env.DB, rs.id);
  return c.json({ user: fresh }, 201);
});

users.patch('/:id', requireCap('user.write'), async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const existing = await loadAdminUser(c.env.DB, id);
  if (!existing) return err(c, 'not_found', 404);
  const body = await c.req.json<AdminBody>().catch(() => ({}) as AdminBody);

  const userId = body.user_id !== undefined ? body.user_id.toString().trim() : existing.user_id;
  const fullName = body.full_name !== undefined ? body.full_name.toString().trim() : existing.full_name;
  if (!userId) return err(c, 'bad_request', 400, 'user_id required');
  if (!fullName) return err(c, 'bad_request', 400, 'full_name required');

  let role: Role = existing.role;
  if (body.role !== undefined) {
    const parsed = parseRole(body.role);
    if (!parsed) return err(c, 'bad_request', 400, 'role must be one of the eight roles');
    role = parsed;
  }
  const scopeLevel = SCOPE_FOR_ROLE[role];

  // scope_id resolves against the new (post-edit) scope_level. If the
  // role didn't change and the body omits scope_id, we keep the
  // existing value; if the role changed, the body must provide a
  // valid scope_id (or null for global).
  let scopeId: number | null;
  if (scopeLevel === 'global') {
    scopeId = null;
  } else if (role !== existing.role || body.scope_id !== undefined) {
    const raw = body.scope_id;
    if (raw === undefined || raw === null) {
      return err(c, 'bad_request', 400, 'scope_id required for non-global scope');
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      return err(c, 'bad_request', 400, 'scope_id must be a positive integer');
    }
    scopeId = n;
  } else {
    scopeId = existing.scope_id;
  }
  const scopeError = await validateScope(c.env.DB, scopeLevel, scopeId);
  if (scopeError) return err(c, 'bad_request', 400, scopeError);

  // qualification_id: undefined preserves, null clears, integer sets.
  let qualificationId: number | null = existing.qualification_id;
  if ('qualification_id' in body) {
    if (body.qualification_id === null || body.qualification_id === undefined) {
      qualificationId = null;
    } else {
      const n = Number(body.qualification_id);
      if (!Number.isInteger(n) || n <= 0) {
        return err(c, 'bad_request', 400, 'qualification_id must be a positive integer or null');
      }
      qualificationId = n;
    }
    const qualError = await validateQualification(c.env.DB, qualificationId);
    if (qualError) return err(c, 'bad_request', 400, qualError);
  }

  if (userId !== existing.user_id) {
    const conflict = await c.env.DB
      .prepare('SELECT id FROM user WHERE user_id = ? AND id != ?')
      .bind(userId, id)
      .first<{ id: number }>();
    if (conflict) return err(c, 'conflict', 409, 'user_id already exists');
  }

  await c.env.DB
    .prepare(
      `UPDATE user
          SET user_id = ?, full_name = ?, role = ?, scope_level = ?, scope_id = ?,
              qualification_id = ?
        WHERE id = ?`,
    )
    .bind(userId, fullName, role, scopeLevel, scopeId, qualificationId, id)
    .run();
  const fresh = await loadAdminUser(c.env.DB, id);
  return c.json({ user: fresh });
});

export default users;
