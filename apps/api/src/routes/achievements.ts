import { Hono } from 'hono';
import type {
  AchievementType,
  AchievementWithStudent,
} from '@navsahyog/shared';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { assertVillageInScope, villageIdsInScope } from '../scope';
import { err } from '../lib/errors';
import { withIdempotency } from '../lib/idempotency';
import { isIsoDate, nowEpochSeconds } from '../lib/time';
import type { Bindings, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

const MAX_DESCRIPTION_LEN = 500;
const ACHIEVEMENT_TYPES: readonly AchievementType[] = ['som', 'gold', 'silver'];

type PostBody = {
  student_id?: number;
  description?: string;
  date?: string;
  type?: AchievementType;
  gold_count?: number | null;
  silver_count?: number | null;
};

type PatchBody = {
  description?: string;
  date?: string;
  gold_count?: number | null;
  silver_count?: number | null;
};

type AchievementRow = AchievementWithStudent;

// Columns projected to the wire. Joins student + village so the UI
// doesn't round-trip for names.
const SELECT_COLUMNS = `
  a.id, a.student_id, a.description, a.date, a.type,
  a.gold_count, a.silver_count,
  s.first_name AS student_first_name,
  s.last_name  AS student_last_name,
  s.village_id AS village_id,
  v.name       AS village_name
`;
const BASE_FROM = `
  FROM achievement a
  JOIN student s ON s.id = a.student_id
  JOIN village v ON v.id = s.village_id
`;

// Walked by scripts/gen-matrix.mjs.
export const meta: RouteMeta = {
  context: 'programs',
  resource: 'achievements',
  cra: 'create-only',
  offline: { write: 'required', read: 'online-only' },
  refs: ['§3.4', 'L4.1a'],
};

const achievements = new Hono<{ Bindings: Bindings; Variables: Variables }>();

achievements.use('*', requireAuth);

function parseType(raw: unknown): AchievementType | null {
  return typeof raw === 'string' && (ACHIEVEMENT_TYPES as readonly string[]).includes(raw)
    ? (raw as AchievementType)
    : null;
}

// For gold/silver, the matching count field is required and ≥ 1;
// the other count must be omitted or null. For som both must be
// null. Returns the canonicalised {gold,silver} pair or an error.
function parseMedalCounts(
  type: AchievementType,
  gold: unknown,
  silver: unknown,
): { gold: number | null; silver: number | null } | { error: string } {
  const goldNum = gold === null || gold === undefined ? null : Number(gold);
  const silverNum = silver === null || silver === undefined ? null : Number(silver);
  if (goldNum !== null && (!Number.isInteger(goldNum) || goldNum < 1)) {
    return { error: 'gold_count must be a positive integer' };
  }
  if (silverNum !== null && (!Number.isInteger(silverNum) || silverNum < 1)) {
    return { error: 'silver_count must be a positive integer' };
  }
  if (type === 'som') {
    if (goldNum !== null || silverNum !== null) {
      return { error: 'som achievements cannot carry medal counts' };
    }
    return { gold: null, silver: null };
  }
  if (type === 'gold') {
    if (goldNum === null) return { error: 'gold_count required for type=gold' };
    if (silverNum !== null) {
      return { error: 'silver_count cannot be set on type=gold' };
    }
    return { gold: goldNum, silver: null };
  }
  // type === 'silver'
  if (silverNum === null) return { error: 'silver_count required for type=silver' };
  if (goldNum !== null) {
    return { error: 'gold_count cannot be set on type=silver' };
  }
  return { gold: null, silver: silverNum };
}

async function loadStudent(
  db: D1Database,
  id: number,
): Promise<{ id: number; village_id: number; graduated_at: string | null } | null> {
  return (
    (await db
      .prepare('SELECT id, village_id, graduated_at FROM student WHERE id = ?')
      .bind(id)
      .first<{ id: number; village_id: number; graduated_at: string | null }>()) ?? null
  );
}

async function loadAchievement(
  db: D1Database,
  id: number,
): Promise<AchievementRow | null> {
  return (
    (await db
      .prepare(`SELECT ${SELECT_COLUMNS} ${BASE_FROM} WHERE a.id = ?`)
      .bind(id)
      .first<AchievementRow>()) ?? null
  );
}

// ---- routes -------------------------------------------------------

// GET /api/achievements?village_id=&from=&to=&type=
// Filters: village_id optional (scope-filtered anyway). from/to are
// inclusive IST date bounds; default is "current month" so the
// achievements page lands useful on first load.
achievements.get('/', requireCap('achievement.read'), async (c) => {
  const user = c.get('user');
  const villageIdParam = c.req.query('village_id');
  const villageIdFilter = villageIdParam ? Number(villageIdParam) : null;
  if (villageIdParam !== undefined && !villageIdFilter) {
    return err(c, 'bad_request', 400, 'village_id must be a positive integer');
  }
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (from && !isIsoDate(from)) {
    return err(c, 'bad_request', 400, 'from must be YYYY-MM-DD');
  }
  if (to && !isIsoDate(to)) {
    return err(c, 'bad_request', 400, 'to must be YYYY-MM-DD');
  }
  const typeFilter = c.req.query('type');
  if (typeFilter && !parseType(typeFilter)) {
    return err(c, 'bad_request', 400, 'type must be som|gold|silver');
  }

  if (villageIdFilter && !(await assertVillageInScope(c.env.DB, user, villageIdFilter))) {
    return err(c, 'forbidden', 403);
  }
  const scopeIds = villageIdFilter
    ? [villageIdFilter]
    : await villageIdsInScope(c.env.DB, user);
  if (scopeIds.length === 0) return c.json({ achievements: [] });

  const clauses: string[] = [];
  const params: unknown[] = [];
  const placeholders = scopeIds.map(() => '?').join(',');
  clauses.push(`a.student_id IN (SELECT id FROM student WHERE village_id IN (${placeholders}))`);
  params.push(...scopeIds);
  if (from) { clauses.push('a.date >= ?'); params.push(from); }
  if (to)   { clauses.push('a.date <= ?'); params.push(to); }
  if (typeFilter) { clauses.push('a.type = ?'); params.push(typeFilter); }

  const rs = await c.env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} ${BASE_FROM}
     WHERE ${clauses.join(' AND ')}
     ORDER BY a.date DESC, a.id DESC`,
  )
    .bind(...params)
    .all<AchievementRow>();
  return c.json({ achievements: rs.results });
});

achievements.get('/:id', requireCap('achievement.read'), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const row = await loadAchievement(c.env.DB, id);
  if (!row) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, row.village_id))) {
    return err(c, 'forbidden', 403);
  }
  return c.json({ achievement: row });
});

achievements.post('/', requireCap('achievement.write'), async (c) => {
  // Pre-validate the body shape outside the idempotency wrapper.
  // Validation errors are deterministic for a given input — they
  // don't need to be cached, and short-circuiting here avoids
  // polluting the idempotency table with "bad_request" replies.
  const user = c.get('user');
  const body = await c.req.json<PostBody>().catch(() => ({}) as PostBody);
  const studentId = body.student_id;
  const description = (body.description ?? '').toString().trim();
  const date = body.date;
  const type = parseType(body.type);

  if (!studentId) return err(c, 'bad_request', 400, 'student_id required');
  if (!description) return err(c, 'bad_request', 400, 'description required');
  if (description.length > MAX_DESCRIPTION_LEN) {
    return err(c, 'bad_request', 400, `description exceeds ${MAX_DESCRIPTION_LEN} chars`);
  }
  if (!date || !isIsoDate(date)) {
    return err(c, 'bad_request', 400, 'date must be YYYY-MM-DD');
  }
  if (!type) return err(c, 'bad_request', 400, 'type must be som|gold|silver');

  const medal = parseMedalCounts(type, body.gold_count, body.silver_count);
  if ('error' in medal) return err(c, 'bad_request', 400, medal.error);

  const student = await loadStudent(c.env.DB, studentId);
  if (!student) return err(c, 'bad_request', 400, 'unknown student_id');
  if (student.graduated_at) {
    return err(c, 'bad_request', 400, 'student is graduated');
  }
  if (!(await assertVillageInScope(c.env.DB, user, student.village_id))) {
    return err(c, 'forbidden', 403);
  }

  return withIdempotency(c, async () => {
    const now = nowEpochSeconds();

    if (type === 'som') {
      // "One SoM per student per month — a second SoM replaces the
      // existing row" (§3.5). UPSERT on the partial unique index.
      // `substr(date, 1, 7)` extracts 'YYYY-MM' to match the index
      // expression; the WHERE predicate narrows the conflict target
      // to the partial index. D1 / SQLite supports this form.
      //
      // `was_update` is the RETURNING expression that distinguishes
      // an insert from a replace: the UPDATE branch always writes a
      // non-null `updated_at`, the INSERT branch leaves it NULL. Used
      // to pick 201 vs 200 — a replace isn't a creation.
      const row = await c.env.DB.prepare(
        `INSERT INTO achievement
           (student_id, description, date, type, created_at, created_by)
         VALUES (?, ?, ?, 'som', ?, ?)
         ON CONFLICT (student_id, substr(date, 1, 7)) WHERE type = 'som'
         DO UPDATE SET
           description = excluded.description,
           date = excluded.date,
           updated_at = ?,
           updated_by = ?
         RETURNING id, (updated_at IS NOT NULL) AS was_update`,
      )
        .bind(studentId, description, date, now, user.id, now, user.id)
        .first<{ id: number; was_update: number }>();
      if (!row) {
        return { status: 500, body: { error: { code: 'internal_error', message: 'upsert failed' } } };
      }
      const fresh = await loadAchievement(c.env.DB, row.id);
      return { status: row.was_update ? 200 : 201, body: { achievement: fresh } };
    }

    const rs = await c.env.DB.prepare(
      `INSERT INTO achievement
         (student_id, description, date, type, gold_count, silver_count,
          created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
      .bind(
        studentId,
        description,
        date,
        type,
        medal.gold,
        medal.silver,
        now,
        user.id,
      )
      .first<{ id: number }>();
    if (!rs) {
      return { status: 500, body: { error: { code: 'internal_error', message: 'insert failed' } } };
    }
    const fresh = await loadAchievement(c.env.DB, rs.id);
    return { status: 201, body: { achievement: fresh } };
  });
});

// PATCH updates description, date, and the matching medal count.
// Type is immutable — changing gold → som would force a medal-count
// cleanup and could collide with the SoM month uniqueness; simpler
// to require DELETE + POST.
achievements.patch('/:id', requireCap('achievement.write'), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const existing = await loadAchievement(c.env.DB, id);
  if (!existing) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, existing.village_id))) {
    return err(c, 'forbidden', 403);
  }
  const body = await c.req.json<PatchBody>().catch(() => ({}) as PatchBody);

  const description = body.description !== undefined
    ? body.description.toString().trim()
    : existing.description;
  if (!description) return err(c, 'bad_request', 400, 'description required');
  if (description.length > MAX_DESCRIPTION_LEN) {
    return err(c, 'bad_request', 400, `description exceeds ${MAX_DESCRIPTION_LEN} chars`);
  }

  const date = body.date ?? existing.date;
  if (!isIsoDate(date)) {
    return err(c, 'bad_request', 400, 'date must be YYYY-MM-DD');
  }

  // Medal-count patching: for gold/silver, allow updating the matching
  // count; other count must stay null. For som, both must stay null.
  const type = existing.type;
  const goldInput = 'gold_count' in body ? body.gold_count : existing.gold_count;
  const silverInput = 'silver_count' in body ? body.silver_count : existing.silver_count;
  const medal = parseMedalCounts(type, goldInput, silverInput);
  if ('error' in medal) return err(c, 'bad_request', 400, medal.error);

  // If this is a SoM row and the date is moving to a different month,
  // check uq_som_per_month before UPDATE. Without this guard SQLite
  // raises a raw constraint error that surfaces as a 500; caller
  // needs a structured 409 to distinguish it from a bug.
  if (type === 'som' && date.slice(0, 7) !== existing.date.slice(0, 7)) {
    const conflict = await c.env.DB
      .prepare(
        `SELECT id FROM achievement
         WHERE student_id = ? AND type = 'som'
           AND substr(date, 1, 7) = ? AND id != ?
         LIMIT 1`,
      )
      .bind(existing.student_id, date.slice(0, 7), id)
      .first<{ id: number }>();
    if (conflict) {
      return err(
        c, 'conflict', 409,
        'another Star of the Month exists for this student in the target month',
      );
    }
  }

  const now = nowEpochSeconds();
  await c.env.DB.prepare(
    `UPDATE achievement SET
       description = ?, date = ?,
       gold_count = ?, silver_count = ?,
       updated_at = ?, updated_by = ?
     WHERE id = ?`,
  )
    .bind(description, date, medal.gold, medal.silver, now, user.id, id)
    .run();
  const fresh = await loadAchievement(c.env.DB, id);
  return c.json({ achievement: fresh });
});

achievements.delete('/:id', requireCap('achievement.write'), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const existing = await loadAchievement(c.env.DB, id);
  if (!existing) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, existing.village_id))) {
    return err(c, 'forbidden', 403);
  }
  await c.env.DB.prepare('DELETE FROM achievement WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default achievements;
