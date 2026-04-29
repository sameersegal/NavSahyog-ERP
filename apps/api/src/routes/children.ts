import { Hono } from 'hono';
import { isIndianPhone, type GraduationReason, type Student } from '@navsahyog/shared';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { assertVillageInScope } from '../scope';
import { err } from '../lib/errors';
import { withIdempotency } from '../lib/idempotency';
import { isIsoDate, nowEpochSeconds, todayIstDate } from '../lib/time';
import type { Bindings, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

type ProfileBody = {
  father_name?: string | null;
  father_phone?: string | null;
  father_has_smartphone?: 0 | 1 | boolean | null;
  mother_name?: string | null;
  mother_phone?: string | null;
  mother_has_smartphone?: 0 | 1 | boolean | null;
  alt_contact_name?: string | null;
  alt_contact_phone?: string | null;
  alt_contact_relationship?: string | null;
};

type AddBody = ProfileBody & {
  village_id?: number;
  school_id?: number;
  first_name?: string;
  last_name?: string;
  gender?: 'm' | 'f' | 'o';
  dob?: string;
  joined_at?: string;
  photo_media_id?: number | null;
};

type PatchBody = ProfileBody & {
  school_id?: number;
  first_name?: string;
  last_name?: string;
  gender?: 'm' | 'f' | 'o';
  dob?: string;
  joined_at?: string;
  photo_media_id?: number | null;
};

type GraduateBody = {
  graduated_at?: string;
  graduation_reason?: GraduationReason;
};

// Student shape we actually project out. Same as the shared wire
// shape, sourced directly from the DB so a column add flows through
// with no hand-maintained mapping. `created_at` / `created_by` /
// `updated_at` / `updated_by` stay server-internal for now.
const STUDENT_COLUMNS = `
  id, village_id, school_id, first_name, last_name, gender, dob,
  joined_at, graduated_at, graduation_reason,
  father_name, father_phone, father_has_smartphone,
  mother_name, mother_phone, mother_has_smartphone,
  alt_contact_name, alt_contact_phone, alt_contact_relationship,
  photo_media_id
`;

// Walked by scripts/gen-matrix.mjs. POST is offline-eligible
// (D35 — server-side create with a client ULID idempotency key);
// PATCH and /graduate are online-only per offline-scope.md §3.2.2.
// File-level `offline.write` reflects the primary write (POST).
export const meta: RouteMeta = {
  context: 'beneficiaries',
  resource: 'children',
  cra: 'create-only',
  offline: { write: 'eligible', read: 'cached' },
  refs: ['§3.2.2', 'D35'],
};

const children = new Hono<{ Bindings: Bindings; Variables: Variables }>();

children.use('*', requireAuth);

// ---- helpers ------------------------------------------------------

function normaliseFlag(raw: unknown): 0 | 1 | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (raw === true || raw === 1) return 1;
  if (raw === false || raw === 0) return 0;
  return 'invalid';
}

function normalisePhone(raw: unknown): string | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return 'invalid';
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!isIndianPhone(trimmed)) return 'invalid';
  // Canonicalise to `+91XXXXXXXXXX`. Without this, the same
  // number submitted with and without prefix would store as two
  // distinct strings and break any future parent-identity dedup.
  return trimmed.startsWith('+91') ? trimmed : `+91${trimmed}`;
}

type ParsedProfile = {
  father_name: string | null;
  father_phone: string | null;
  father_has_smartphone: 0 | 1 | null;
  mother_name: string | null;
  mother_phone: string | null;
  mother_has_smartphone: 0 | 1 | null;
  alt_contact_name: string | null;
  alt_contact_phone: string | null;
  alt_contact_relationship: string | null;
};

type ProfileError = { message: string };

// Parses + validates the parent/alt-contact block shared by POST
// (create) and PATCH (edit). Returns a ProfileError if any field is
// malformed, `null` if `requireParent` was set and neither parent is
// named, or `null` if neither parent has a smartphone and alt
// contact is incomplete. Otherwise returns the fully-typed block.
function parseProfile(
  body: ProfileBody,
  requireParent: boolean,
): ParsedProfile | ProfileError {
  const fatherName = (body.father_name ?? '').toString().trim() || null;
  const motherName = (body.mother_name ?? '').toString().trim() || null;
  if (requireParent && !fatherName && !motherName) {
    return { message: 'at least one parent required' };
  }

  const fatherPhone = normalisePhone(body.father_phone);
  if (fatherPhone === 'invalid') {
    return { message: 'father_phone must be a valid Indian mobile number' };
  }
  const motherPhone = normalisePhone(body.mother_phone);
  if (motherPhone === 'invalid') {
    return { message: 'mother_phone must be a valid Indian mobile number' };
  }

  const fatherSmartphone = normaliseFlag(body.father_has_smartphone);
  if (fatherSmartphone === 'invalid') {
    return { message: 'father_has_smartphone must be boolean' };
  }
  const motherSmartphone = normaliseFlag(body.mother_has_smartphone);
  if (motherSmartphone === 'invalid') {
    return { message: 'mother_has_smartphone must be boolean' };
  }

  // A smartphone flag is only meaningful alongside a phone number.
  if (fatherSmartphone !== null && fatherPhone === null) {
    return { message: 'father_has_smartphone set without father_phone' };
  }
  if (motherSmartphone !== null && motherPhone === null) {
    return { message: 'mother_has_smartphone set without mother_phone' };
  }

  // §3.2.2: alt contact is required when neither parent has a
  // smartphone. The rule triggers only when at least one parent
  // phone exists (no smartphone flag is meaningless without a phone).
  const anyParentSmartphone =
    fatherSmartphone === 1 || motherSmartphone === 1;
  const anyParentPhone = fatherPhone !== null || motherPhone !== null;
  const altName = (body.alt_contact_name ?? '').toString().trim() || null;
  const altPhone = normalisePhone(body.alt_contact_phone);
  if (altPhone === 'invalid') {
    return { message: 'alt_contact_phone must be a valid Indian mobile number' };
  }
  const altRelationship = (body.alt_contact_relationship ?? '').toString().trim() || null;

  const altProvided = altName !== null || altPhone !== null || altRelationship !== null;
  if (altProvided && (!altName || !altPhone || !altRelationship)) {
    return {
      message: 'alt_contact_* requires name, phone, and relationship together',
    };
  }

  if (anyParentPhone && !anyParentSmartphone && !altProvided) {
    return {
      message: 'alt contact required when neither parent has a smartphone',
    };
  }

  return {
    father_name: fatherName,
    father_phone: fatherPhone,
    father_has_smartphone: fatherSmartphone,
    mother_name: motherName,
    mother_phone: motherPhone,
    mother_has_smartphone: motherSmartphone,
    alt_contact_name: altName,
    alt_contact_phone: altPhone,
    alt_contact_relationship: altRelationship,
  };
}

// Resolve `photo_media_id` against the DB:
//   * undefined  → keep the existing / no-op
//   * null       → detach (set column to NULL)
//   * integer    → verify the media row exists, isn't deleted, and
//                  belongs to `villageId` (same scope as the student)
// Returns the numeric id, explicit null, or an error string.
async function resolvePhotoMediaId(
  db: D1Database,
  raw: number | null | undefined,
  villageId: number,
): Promise<{ value: number | null } | { error: string }> {
  if (raw === undefined) return { value: null };
  if (raw === null) return { value: null };
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'photo_media_id must be a positive integer or null' };
  }
  const row = await db
    .prepare(
      `SELECT id, village_id, kind, deleted_at
       FROM media WHERE id = ?`,
    )
    .bind(id)
    .first<{ id: number; village_id: number; kind: string; deleted_at: number | null }>();
  if (!row || row.deleted_at) {
    return { error: 'unknown photo_media_id' };
  }
  if (row.kind !== 'image') {
    return { error: 'photo_media_id must reference an image' };
  }
  if (row.village_id !== villageId) {
    return { error: 'photo_media_id from a different village' };
  }
  return { value: id };
}

async function loadStudent(
  db: D1Database,
  id: number,
): Promise<Student | null> {
  const row = await db
    .prepare(`SELECT ${STUDENT_COLUMNS} FROM student WHERE id = ?`)
    .bind(id)
    .first<Student>();
  return row ?? null;
}

// PATCH merge-with-existing. Distinguish "key absent" (preserve) from
// "key present with null" (explicit clear) via the `in` operator —
// JSON.parse never produces `undefined`, so a client wanting to clear
// a field sends explicit `null`. The merged block is then passed
// through parseProfile so the §3.3 alt-contact rule runs against the
// final state, not the patch delta.
function mergeProfile(body: ProfileBody, existing: Student): ProfileBody {
  return {
    father_name: 'father_name' in body ? body.father_name : existing.father_name,
    father_phone: 'father_phone' in body ? body.father_phone : existing.father_phone,
    father_has_smartphone:
      'father_has_smartphone' in body
        ? body.father_has_smartphone
        : existing.father_has_smartphone,
    mother_name: 'mother_name' in body ? body.mother_name : existing.mother_name,
    mother_phone: 'mother_phone' in body ? body.mother_phone : existing.mother_phone,
    mother_has_smartphone:
      'mother_has_smartphone' in body
        ? body.mother_has_smartphone
        : existing.mother_has_smartphone,
    alt_contact_name:
      'alt_contact_name' in body ? body.alt_contact_name : existing.alt_contact_name,
    alt_contact_phone:
      'alt_contact_phone' in body ? body.alt_contact_phone : existing.alt_contact_phone,
    alt_contact_relationship:
      'alt_contact_relationship' in body
        ? body.alt_contact_relationship
        : existing.alt_contact_relationship,
  };
}

// ---- routes -------------------------------------------------------

children.get('/', requireCap('child.read'), async (c) => {
  const user = c.get('user');
  const villageId = Number(c.req.query('village_id'));
  if (!villageId) return err(c, 'bad_request', 400, 'village_id required');
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return err(c, 'forbidden', 403);
  }
  const includeGraduated = c.req.query('include_graduated') === '1';
  // `graduated_at IS NULL DESC` puts active students (where the
  // expression is 1/true) ahead of graduated ones. `COLLATE NOCASE`
  // is an ASCII-only improvement; Devanagari/Kannada/Tamil names
  // still byte-order here — revisit when D1 supports ICU collation.
  const sql = includeGraduated
    ? `SELECT ${STUDENT_COLUMNS} FROM student WHERE village_id = ?
       ORDER BY graduated_at IS NULL DESC,
                first_name COLLATE NOCASE, last_name COLLATE NOCASE`
    : `SELECT ${STUDENT_COLUMNS} FROM student
       WHERE village_id = ? AND graduated_at IS NULL
       ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE`;
  const rs = await c.env.DB.prepare(sql).bind(villageId).all<Student>();
  return c.json({ children: rs.results });
});

children.get('/:id', requireCap('child.read'), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const student = await loadStudent(c.env.DB, id);
  if (!student) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, student.village_id))) {
    return err(c, 'forbidden', 403);
  }
  return c.json({ child: student });
});

children.post('/', requireCap('child.write'), async (c) => {
  // Pre-validate outside the idempotency wrapper. Validation errors
  // are deterministic and cheap to recompute; caching them would
  // pollute the table with bad_request bodies a replay would just
  // hit again.
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
  const joinedAt = body.joined_at ?? todayIstDate();
  if (!isIsoDate(joinedAt)) {
    return err(c, 'bad_request', 400, 'joined_at must be YYYY-MM-DD');
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

  const profile = parseProfile(body, true);
  if ('message' in profile) return err(c, 'bad_request', 400, profile.message);

  const photo = await resolvePhotoMediaId(c.env.DB, body.photo_media_id, village_id);
  if ('error' in photo) return err(c, 'bad_request', 400, photo.error);

  // L4.1b — D35 says POST /api/children is `offline-eligible`. The
  // outbox runner sends an Idempotency-Key on every replay; we
  // dedupe via the L4.1a helper so a retry doesn't create a
  // duplicate child. D35's visibility-after-sync rule lives on the
  // client (cache_students only includes server-confirmed rows);
  // server-side this is just normal idempotency.
  return withIdempotency(c, async () => {
    const now = nowEpochSeconds();
    const rs = await c.env.DB.prepare(
      `INSERT INTO student
         (village_id, school_id, first_name, last_name, gender, dob, joined_at,
          father_name, father_phone, father_has_smartphone,
          mother_name, mother_phone, mother_has_smartphone,
          alt_contact_name, alt_contact_phone, alt_contact_relationship,
          photo_media_id,
          created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?,
               ?,
               ?, ?, ?, ?)
       RETURNING id`,
    )
      .bind(
        village_id,
        school_id,
        first_name.trim(),
        last_name.trim(),
        gender,
        dob,
        joinedAt,
        profile.father_name,
        profile.father_phone,
        profile.father_has_smartphone,
        profile.mother_name,
        profile.mother_phone,
        profile.mother_has_smartphone,
        profile.alt_contact_name,
        profile.alt_contact_phone,
        profile.alt_contact_relationship,
        photo.value,
        now,
        user.id,
        now,
        user.id,
      )
      .first<{ id: number }>();
    return { status: 201, body: { id: rs?.id } };
  });
});

children.patch('/:id', requireCap('child.write'), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const existing = await loadStudent(c.env.DB, id);
  if (!existing) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, existing.village_id))) {
    return err(c, 'forbidden', 403);
  }
  if (existing.graduated_at) {
    return err(c, 'bad_request', 400, 'graduated students cannot be edited');
  }

  const body = await c.req.json<PatchBody>().catch(() => ({}) as PatchBody);

  // Core fields — accept partial updates. village_id is intentionally
  // not editable (changing a village crosses scope boundaries;
  // handle that separately if it ever becomes a requirement).
  const firstName = body.first_name?.trim() ?? existing.first_name;
  const lastName = body.last_name?.trim() ?? existing.last_name;
  const gender = body.gender ?? existing.gender;
  if (!['m', 'f', 'o'].includes(gender)) {
    return err(c, 'bad_request', 400, 'invalid gender');
  }
  const dob = body.dob ?? existing.dob;
  if (!isIsoDate(dob)) {
    return err(c, 'bad_request', 400, 'dob must be YYYY-MM-DD');
  }
  const joinedAt = body.joined_at ?? existing.joined_at;
  if (!isIsoDate(joinedAt)) {
    return err(c, 'bad_request', 400, 'joined_at must be YYYY-MM-DD');
  }
  const schoolId = body.school_id ?? existing.school_id;
  if (schoolId !== existing.school_id) {
    const school = await c.env.DB.prepare(
      'SELECT id FROM school WHERE id = ? AND village_id = ?',
    )
      .bind(schoolId, existing.village_id)
      .first<{ id: number }>();
    if (!school) return err(c, 'bad_request', 400, 'school not in village');
  }

  // Profile block merges with existing values so a partial PATCH
  // (e.g. `{ first_name: '…' }`) doesn't null out parent/alt-contact
  // columns. Validation then runs against the merged state so the
  // §3.3 alt-contact rule checks the final row, not the delta.
  const merged = mergeProfile(body, existing);
  const profile = parseProfile(merged, false);
  if ('message' in profile) return err(c, 'bad_request', 400, profile.message);

  // photo_media_id follows the same key-present / key-absent rule as
  // the profile block: only touch the column when the client sends
  // the key. null explicitly detaches; undefined preserves.
  let photoValue: number | null = existing.photo_media_id;
  if ('photo_media_id' in body) {
    const resolved = await resolvePhotoMediaId(
      c.env.DB,
      body.photo_media_id,
      existing.village_id,
    );
    if ('error' in resolved) return err(c, 'bad_request', 400, resolved.error);
    photoValue = resolved.value;
  }

  const now = nowEpochSeconds();
  await c.env.DB.prepare(
    `UPDATE student SET
       school_id = ?, first_name = ?, last_name = ?, gender = ?,
       dob = ?, joined_at = ?,
       father_name = ?, father_phone = ?, father_has_smartphone = ?,
       mother_name = ?, mother_phone = ?, mother_has_smartphone = ?,
       alt_contact_name = ?, alt_contact_phone = ?, alt_contact_relationship = ?,
       photo_media_id = ?,
       updated_at = ?, updated_by = ?
     WHERE id = ?`,
  )
    .bind(
      schoolId,
      firstName,
      lastName,
      gender,
      dob,
      joinedAt,
      profile.father_name,
      profile.father_phone,
      profile.father_has_smartphone,
      profile.mother_name,
      profile.mother_phone,
      profile.mother_has_smartphone,
      profile.alt_contact_name,
      profile.alt_contact_phone,
      profile.alt_contact_relationship,
      photoValue,
      now,
      user.id,
      id,
    )
    .run();
  const fresh = await loadStudent(c.env.DB, id);
  return c.json({ child: fresh });
});

children.post('/:id/graduate', requireCap('child.write'), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const existing = await loadStudent(c.env.DB, id);
  if (!existing) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, existing.village_id))) {
    return err(c, 'forbidden', 403);
  }
  if (existing.graduated_at) {
    return err(c, 'bad_request', 400, 'already graduated');
  }
  const body = await c.req.json<GraduateBody>().catch(() => ({}) as GraduateBody);
  const graduatedAt = body.graduated_at ?? todayIstDate();
  if (!isIsoDate(graduatedAt)) {
    return err(c, 'bad_request', 400, 'graduated_at must be YYYY-MM-DD');
  }
  if (graduatedAt > todayIstDate()) {
    return err(c, 'bad_request', 400, 'graduated_at cannot be in the future');
  }
  if (graduatedAt < existing.joined_at) {
    return err(c, 'bad_request', 400, 'graduated_at cannot precede joined_at');
  }
  const reason = body.graduation_reason ?? 'pass_out';
  if (!['pass_out', 'other'].includes(reason)) {
    return err(c, 'bad_request', 400, 'invalid graduation_reason');
  }
  const now = nowEpochSeconds();
  // `AND graduated_at IS NULL` closes the TOCTOU between the read
  // above and this write: if two graduate requests race, only the
  // first commits, and the second's `meta.changes === 0` falls
  // through to the 400 below.
  const rs = await c.env.DB.prepare(
    `UPDATE student
       SET graduated_at = ?, graduation_reason = ?, updated_at = ?, updated_by = ?
       WHERE id = ? AND graduated_at IS NULL`,
  )
    .bind(graduatedAt, reason, now, user.id, id)
    .run();
  if (rs.meta.changes === 0) {
    return err(c, 'bad_request', 400, 'already graduated');
  }
  const fresh = await loadStudent(c.env.DB, id);
  return c.json({ child: fresh });
});

export default children;
