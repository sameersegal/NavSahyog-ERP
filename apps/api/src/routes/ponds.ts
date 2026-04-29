// Jal Vriddhi pond routes — create farmer + pond, presign +
// commit agreement scan uploads, list + get with full version
// history. Spec §3.10, §5.18.
//
// Three-step upload flow (mirrors media):
//   1. POST /api/ponds/agreements/presign → { upload_url, r2_key, uuid, exp }
//   2. PUT  <upload_url>                  → bytes land in R2
//   3a. POST /api/ponds                    → create farmer + pond + version 1
//   3b. POST /api/ponds/:id/agreements     → append version N+1 to existing pond
//
// The presign isn't bound to a pond at sign time — the same token
// works for both the create flow (where the pond doesn't exist yet)
// and the re-upload flow. The pond_id binding happens at commit.
//
// Versioning: each pond's agreements live in
// `pond_agreement_version` with a monotonic per-pond `version`
// column. Re-upload appends; we never UPDATE a row. The "current"
// agreement on the list view is `MAX(version) WHERE pond_id = ?`.

import { Hono } from 'hono';
import {
  AGREEMENT_MAX_BYTES,
  isIndianPhone,
  type AppendAgreementRequest,
  type AgreementCommitRef,
  type AgreementPresignRequest,
  type AgreementPresignResponse,
  type CreatePondRequest,
  type Farmer,
  type Pond,
  type PondAgreementVersion,
  type PondDetail,
  type PondListItem,
  type PondStatus,
  isPondStatus,
} from '@navsahyog/shared';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { assertVillageInScope, villageIdsInScope } from '../scope';
import { err } from '../lib/errors';
import { nowEpochSeconds } from '../lib/time';
import {
  AGREEMENT_PRESIGN_TTL_SECONDS,
  buildR2Key,
  canonicalMime,
  isAgreementMimeAllowed,
  isUuid,
  signUploadToken,
  verifyUploadToken,
} from '../lib/agreement';
import type { Bindings, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

const NOTES_MAX_LEN = 500;
const AGREEMENT_NOTES_MAX_LEN = 200;
const FILENAME_MAX_LEN = 255;

// Walked by scripts/gen-matrix.mjs.
export const meta: RouteMeta = {
  context: 'programs',
  resource: 'ponds',
  cra: 'create-only',
  // D25: online-only because the agreement scan is the high-stakes
  // artefact in this workflow. Revisit at L4.2.
  offline: { write: 'online-only', read: 'online-only' },
  refs: ['§3.10', 'D25'],
};

const ponds = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ---- raw upload (token-gated, no session) -------------------------
//
// PUT /api/ponds/agreements/upload/:uuid?token=...
//
// Mirrors `/api/media/upload/:uuid` — bytes flow through the Worker
// into the R2 binding, gated by the HMAC token rather than the
// session cookie. Same staging-basic-auth carve-out applies (see
// src/index.ts) since the endpoint is presigned, not session-bound.
ponds.put('/agreements/upload/:uuid', async (c) => {
  if (!c.env.MEDIA) return err(c, 'internal_error', 500, 'media bucket not bound');
  const secret = c.env.MEDIA_PRESIGN_SECRET;
  if (!secret) return err(c, 'internal_error', 500, 'presign secret not configured');

  const token = c.req.query('token');
  if (!token) return err(c, 'unauthenticated', 401, 'missing token');

  const payload = await verifyUploadToken(secret, token, nowEpochSeconds());
  if (!payload) return err(c, 'unauthenticated', 401, 'invalid or expired token');

  const uuidFromPath = c.req.param('uuid');
  if (uuidFromPath !== payload.uuid) {
    return err(c, 'bad_request', 400, 'uuid mismatch');
  }

  const rawContentType = c.req.header('content-type');
  if (!rawContentType || canonicalMime(rawContentType) !== payload.mime) {
    return err(c, 'bad_request', 400, 'content-type does not match token mime');
  }

  // Replay guard: the uuid is unique across `pond_agreement_version`,
  // so once any version has committed under this uuid the R2 object
  // must not be overwritten. (Replay-before-commit is harmless; the
  // PUT writes the same key with the same token-bound mime.)
  const existing = await c.env.DB
    .prepare('SELECT id FROM pond_agreement_version WHERE uuid = ?')
    .bind(payload.uuid)
    .first<{ id: number }>();
  if (existing) {
    return err(c, 'conflict', 409, 'agreement with this uuid is already committed');
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength > payload.max_bytes || body.byteLength > AGREEMENT_MAX_BYTES) {
    return err(c, 'bad_request', 413, 'payload exceeds cap');
  }

  await c.env.MEDIA.put(payload.r2_key, body, {
    httpMetadata: { contentType: payload.mime },
    customMetadata: {
      uploaded_by: String(payload.user_id),
      village_id: String(payload.village_id),
      kind: 'agreement',
    },
  });

  return c.json({ ok: true, bytes: body.byteLength });
});

// ---- presign ------------------------------------------------------

ponds.post('/agreements/presign', requireAuth, requireCap('pond.write'), async (c) => {
  const secret = c.env.MEDIA_PRESIGN_SECRET;
  if (!secret) return err(c, 'internal_error', 500, 'presign secret not configured');
  const user = c.get('user');
  const body = await c.req
    .json<AgreementPresignRequest>()
    .catch(() => ({}) as AgreementPresignRequest);

  if (!isUuid(body.uuid)) {
    return err(c, 'bad_request', 400, 'uuid must be a UUIDv4');
  }
  if (typeof body.mime !== 'string' || !isAgreementMimeAllowed(body.mime)) {
    return err(c, 'bad_request', 400, 'mime must be PDF, JPEG, or PNG');
  }
  if (!Number.isInteger(body.bytes) || body.bytes <= 0) {
    return err(c, 'bad_request', 400, 'bytes must be a positive integer');
  }
  if (body.bytes > AGREEMENT_MAX_BYTES) {
    return err(c, 'bad_request', 413, 'bytes exceeds 25 MiB cap');
  }
  const villageId = Number(body.village_id);
  if (!villageId) return err(c, 'bad_request', 400, 'village_id required');
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return err(c, 'forbidden', 403);
  }

  const now = nowEpochSeconds();
  const expiresAt = now + AGREEMENT_PRESIGN_TTL_SECONDS;
  const r2Key = buildR2Key({
    uuid: body.uuid,
    mime: body.mime,
    villageId,
    uploadedAtEpoch: now,
  });

  const token = await signUploadToken(secret, {
    uuid: body.uuid,
    r2_key: r2Key,
    mime: body.mime,
    max_bytes: body.bytes,
    village_id: villageId,
    user_id: user.id,
    exp: expiresAt,
  });

  const uploadUrl = `/api/ponds/agreements/upload/${body.uuid}?token=${encodeURIComponent(token)}`;

  const response: AgreementPresignResponse = {
    uuid: body.uuid,
    r2_key: r2Key,
    upload_url: uploadUrl,
    upload_method: 'PUT',
    expires_at: expiresAt,
  };
  return c.json(response);
});

// ---- create farmer + pond + version 1 -----------------------------

ponds.post('/', requireAuth, requireCap('pond.write'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<CreatePondRequest>().catch(() => ({}) as CreatePondRequest);

  // Farmer: caller supplies either an existing farmer_id (must be in
  // scope) or a new-farmer block. Exactly one of the two is allowed.
  const hasExistingFarmer = body.farmer_id !== undefined && body.farmer_id !== null;
  const hasNewFarmer = body.farmer !== undefined && body.farmer !== null;
  if (hasExistingFarmer === hasNewFarmer) {
    return err(c, 'bad_request', 400, 'specify exactly one of farmer_id or farmer');
  }

  let farmerId: number;
  let farmerVillageId: number;
  if (hasExistingFarmer) {
    const fid = Number(body.farmer_id);
    if (!Number.isInteger(fid) || fid <= 0) {
      return err(c, 'bad_request', 400, 'farmer_id must be a positive integer');
    }
    const row = await c.env.DB
      .prepare('SELECT id, village_id FROM farmer WHERE id = ? AND deleted_at IS NULL')
      .bind(fid)
      .first<{ id: number; village_id: number }>();
    if (!row) return err(c, 'not_found', 404, 'farmer not found');
    if (!(await assertVillageInScope(c.env.DB, user, row.village_id))) {
      return err(c, 'forbidden', 403);
    }
    farmerId = row.id;
    farmerVillageId = row.village_id;
  } else {
    const farmerInput = body.farmer!;
    const villageId = Number(farmerInput.village_id);
    if (!villageId) return err(c, 'bad_request', 400, 'farmer.village_id required');
    if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
      return err(c, 'forbidden', 403);
    }
    const fullName = (farmerInput.full_name ?? '').toString().trim();
    if (!fullName) return err(c, 'bad_request', 400, 'farmer.full_name required');
    const phone = normalisePhone(farmerInput.phone);
    if (phone === 'invalid') {
      return err(c, 'bad_request', 400, 'farmer.phone must be a valid Indian mobile number');
    }
    const plot = (farmerInput.plot_identifier ?? '').toString().trim() || null;

    const now = nowEpochSeconds();
    const inserted = await c.env.DB
      .prepare(
        `INSERT INTO farmer
           (village_id, full_name, phone, plot_identifier, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(villageId, fullName, phone, plot, now, user.id)
      .first<{ id: number }>();
    if (!inserted) return err(c, 'internal_error', 500, 'farmer insert failed');
    farmerId = inserted.id;
    farmerVillageId = villageId;
  }

  // Pond fields.
  const pondInput = body.pond;
  if (!pondInput || typeof pondInput !== 'object') {
    return err(c, 'bad_request', 400, 'pond required');
  }
  const lat = Number(pondInput.latitude);
  const lng = Number(pondInput.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return err(c, 'bad_request', 400, 'pond.latitude and pond.longitude required');
  }
  const status: PondStatus = pondInput.status && isPondStatus(pondInput.status)
    ? pondInput.status
    : 'planned';
  const notes = (pondInput.notes ?? '').toString().trim() || null;
  if (notes && notes.length > NOTES_MAX_LEN) {
    return err(c, 'bad_request', 400, `pond.notes exceeds ${NOTES_MAX_LEN} chars`);
  }

  // Agreement: must point to a valid R2 object presigned earlier.
  const agreementCheck = await validateAgreementRef(c.env, body.agreement);
  if ('error' in agreementCheck) {
    return err(c, 'bad_request', 400, agreementCheck.error);
  }

  const now = nowEpochSeconds();
  const pondInserted = await c.env.DB
    .prepare(
      `INSERT INTO pond
         (farmer_id, village_id, latitude, longitude, status, notes,
          created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(farmerId, farmerVillageId, lat, lng, status, notes, now, user.id)
    .first<{ id: number }>();
  if (!pondInserted) return err(c, 'internal_error', 500, 'pond insert failed');

  // Version 1.
  const agreement = agreementCheck.value;
  await c.env.DB
    .prepare(
      `INSERT INTO pond_agreement_version
         (pond_id, version, uuid, r2_key, mime, bytes, original_filename,
          notes, uploaded_at, uploaded_by)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      pondInserted.id,
      agreement.uuid,
      agreement.r2_key,
      agreement.mime,
      agreement.bytes,
      agreement.original_filename,
      agreement.notes,
      now,
      user.id,
    )
    .run();

  const detail = await loadPondDetail(c.env.DB, pondInserted.id);
  if (!detail) return err(c, 'internal_error', 500);
  return c.json({ pond: detail }, 201);
});

// ---- append a new agreement version -------------------------------

ponds.post('/:id/agreements', requireAuth, requireCap('pond.write'), async (c) => {
  const user = c.get('user');
  const pondId = Number(c.req.param('id'));
  if (!pondId) return err(c, 'bad_request', 400, 'pond id required');

  const row = await c.env.DB
    .prepare('SELECT id, village_id FROM pond WHERE id = ? AND deleted_at IS NULL')
    .bind(pondId)
    .first<{ id: number; village_id: number }>();
  if (!row) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, row.village_id))) {
    return err(c, 'forbidden', 403);
  }

  const body = await c.req.json<AppendAgreementRequest>().catch(() => ({}) as AppendAgreementRequest);
  const check = await validateAgreementRef(c.env, body);
  if ('error' in check) {
    return err(c, 'bad_request', 400, check.error);
  }
  const agreement = check.value;

  // Next version: MAX(version) + 1. Done as a single SELECT then
  // INSERT — the UNIQUE(pond_id, version) constraint catches the
  // race if two concurrent appends collide; the loser retries
  // client-side.
  const max = await c.env.DB
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM pond_agreement_version WHERE pond_id = ?')
    .bind(pondId)
    .first<{ v: number }>();
  const nextVersion = (max?.v ?? 0) + 1;

  const now = nowEpochSeconds();
  await c.env.DB
    .prepare(
      `INSERT INTO pond_agreement_version
         (pond_id, version, uuid, r2_key, mime, bytes, original_filename,
          notes, uploaded_at, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      pondId,
      nextVersion,
      agreement.uuid,
      agreement.r2_key,
      agreement.mime,
      agreement.bytes,
      agreement.original_filename,
      agreement.notes,
      now,
      user.id,
    )
    .run();

  const detail = await loadPondDetail(c.env.DB, pondId);
  if (!detail) return err(c, 'internal_error', 500);
  return c.json({ pond: detail }, 201);
});

// ---- list / get ---------------------------------------------------

ponds.get('/', requireAuth, requireCap('pond.read'), async (c) => {
  const user = c.get('user');
  const villageParam = c.req.query('village_id');

  const scopeIds = await villageIdsInScope(c.env.DB, user);
  if (scopeIds.length === 0) return c.json({ ponds: [] });

  const filterVillage = villageParam ? Number(villageParam) : null;
  if (filterVillage !== null) {
    if (!scopeIds.includes(filterVillage)) {
      return err(c, 'forbidden', 403);
    }
  }
  const villageIds = filterVillage ? [filterVillage] : scopeIds;
  const placeholders = villageIds.map(() => '?').join(',');

  const rs = await c.env.DB
    .prepare(
      `SELECT
         p.id          AS pond_id,
         p.farmer_id   AS pond_farmer_id,
         p.village_id  AS pond_village_id,
         p.latitude    AS pond_latitude,
         p.longitude   AS pond_longitude,
         p.status      AS pond_status,
         p.notes       AS pond_notes,
         p.created_at  AS pond_created_at,
         f.id          AS farmer_id,
         f.village_id  AS farmer_village_id,
         f.full_name   AS farmer_full_name,
         f.phone       AS farmer_phone,
         f.plot_identifier AS farmer_plot,
         f.created_at  AS farmer_created_at,
         v.name        AS village_name,
         (SELECT COUNT(*) FROM pond_agreement_version pav
            WHERE pav.pond_id = p.id) AS agreement_count,
         lv.id          AS lv_id,
         lv.version     AS lv_version,
         lv.uuid        AS lv_uuid,
         lv.mime        AS lv_mime,
         lv.bytes       AS lv_bytes,
         lv.original_filename AS lv_original_filename,
         lv.notes       AS lv_notes,
         lv.uploaded_at AS lv_uploaded_at,
         lv.uploaded_by AS lv_uploaded_by
       FROM pond p
       JOIN farmer f ON f.id = p.farmer_id
       JOIN village v ON v.id = p.village_id
       LEFT JOIN pond_agreement_version lv
         ON lv.pond_id = p.id
        AND lv.version = (
          SELECT MAX(version) FROM pond_agreement_version
           WHERE pond_id = p.id
        )
       WHERE p.village_id IN (${placeholders})
         AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 200`,
    )
    .bind(...villageIds)
    .all<ListRow>();

  const items: PondListItem[] = rs.results.map(rowToListItem);
  return c.json({ ponds: items });
});

ponds.get('/:id', requireAuth, requireCap('pond.read'), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'pond id required');
  const detail = await loadPondDetail(c.env.DB, id);
  if (!detail) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, detail.pond.village_id))) {
    return err(c, 'forbidden', 403);
  }
  return c.json({ pond: detail });
});

// Authenticated read-through for the agreement bytes. Mirrors
// `/api/media/raw/:uuid` — streams from R2 via the Worker binding,
// scope-checked against the pond the agreement belongs to.
ponds.get('/agreements/raw/:uuid', requireAuth, requireCap('pond.read'), async (c) => {
  const user = c.get('user');
  const uuid = c.req.param('uuid');
  if (!isUuid(uuid)) return err(c, 'bad_request', 400, 'uuid required');
  const row = await c.env.DB
    .prepare(
      `SELECT pav.r2_key AS r2_key, pav.mime AS mime, p.village_id AS village_id
         FROM pond_agreement_version pav
         JOIN pond p ON p.id = pav.pond_id
        WHERE pav.uuid = ? AND p.deleted_at IS NULL`,
    )
    .bind(uuid)
    .first<{ r2_key: string; mime: string; village_id: number }>();
  if (!row) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, row.village_id))) {
    return err(c, 'forbidden', 403);
  }
  const obj = await c.env.MEDIA.get(row.r2_key);
  if (!obj) return err(c, 'not_found', 404, 'object missing from R2');
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.get('content-type')) {
    headers.set('content-type', row.mime);
  }
  headers.set('cache-control', 'private, max-age=900');
  return new Response(obj.body, { headers });
});

// ---- helpers ------------------------------------------------------

function normalisePhone(raw: unknown): string | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return 'invalid';
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!isIndianPhone(trimmed)) return 'invalid';
  return trimmed.startsWith('+91') ? trimmed : `+91${trimmed}`;
}

type ValidatedAgreement = {
  uuid: string;
  r2_key: string;
  mime: string;
  bytes: number;
  original_filename: string | null;
  notes: string | null;
};

async function validateAgreementRef(
  env: Bindings,
  ref: AgreementCommitRef | undefined,
): Promise<{ value: ValidatedAgreement } | { error: string }> {
  if (!ref || typeof ref !== 'object') {
    return { error: 'agreement required' };
  }
  if (!isUuid(ref.uuid)) return { error: 'agreement.uuid must be a UUIDv4' };
  if (typeof ref.r2_key !== 'string' || !ref.r2_key.startsWith('agreement/')) {
    return { error: 'agreement.r2_key invalid' };
  }
  if (typeof ref.mime !== 'string' || !isAgreementMimeAllowed(ref.mime)) {
    return { error: 'agreement.mime must be PDF, JPEG, or PNG' };
  }
  if (!Number.isInteger(ref.bytes) || ref.bytes <= 0) {
    return { error: 'agreement.bytes must be a positive integer' };
  }
  if (ref.bytes > AGREEMENT_MAX_BYTES) {
    return { error: 'agreement.bytes exceeds 25 MiB cap' };
  }

  let originalFilename: string | null = null;
  if (ref.original_filename !== undefined && ref.original_filename !== null) {
    const f = ref.original_filename.toString().trim();
    if (f.length > FILENAME_MAX_LEN) {
      return { error: `agreement.original_filename exceeds ${FILENAME_MAX_LEN} chars` };
    }
    originalFilename = f || null;
  }

  let notes: string | null = null;
  if (ref.notes !== undefined && ref.notes !== null) {
    const n = ref.notes.toString().trim();
    if (n.length > AGREEMENT_NOTES_MAX_LEN) {
      return { error: `agreement.notes exceeds ${AGREEMENT_NOTES_MAX_LEN} chars` };
    }
    notes = n || null;
  }

  // Idempotency: if a version row already carries this uuid, the
  // commit is a retry. We refuse it from this entry-point — the
  // caller should treat the conflict as "already saved" and move
  // on. (The `/agreements/upload/:uuid` endpoint above already
  // refuses re-PUT under the same uuid.)
  const dup = await env.DB
    .prepare('SELECT id FROM pond_agreement_version WHERE uuid = ?')
    .bind(ref.uuid)
    .first<{ id: number }>();
  if (dup) return { error: 'agreement uuid already committed' };

  // Verify the object landed in R2 at the claimed key and size.
  const head = await env.MEDIA.head(ref.r2_key);
  if (!head) return { error: 'agreement object not present in R2' };
  if (head.size !== ref.bytes) return { error: 'agreement byte count mismatch with R2' };

  return {
    value: {
      uuid: ref.uuid,
      r2_key: ref.r2_key,
      mime: ref.mime,
      bytes: ref.bytes,
      original_filename: originalFilename,
      notes,
    },
  };
}

type ListRow = {
  pond_id: number;
  pond_farmer_id: number;
  pond_village_id: number;
  pond_latitude: number;
  pond_longitude: number;
  pond_status: PondStatus;
  pond_notes: string | null;
  pond_created_at: number;
  farmer_id: number;
  farmer_village_id: number;
  farmer_full_name: string;
  farmer_phone: string | null;
  farmer_plot: string | null;
  farmer_created_at: number;
  village_name: string;
  agreement_count: number;
  lv_id: number | null;
  lv_version: number | null;
  lv_uuid: string | null;
  lv_mime: string | null;
  lv_bytes: number | null;
  lv_original_filename: string | null;
  lv_notes: string | null;
  lv_uploaded_at: number | null;
  lv_uploaded_by: number | null;
};

function rowToListItem(row: ListRow): PondListItem {
  const farmer: Farmer = {
    id: row.farmer_id,
    village_id: row.farmer_village_id,
    full_name: row.farmer_full_name,
    phone: row.farmer_phone,
    plot_identifier: row.farmer_plot,
    created_at: row.farmer_created_at,
  };
  const pond: Pond = {
    id: row.pond_id,
    farmer_id: row.pond_farmer_id,
    village_id: row.pond_village_id,
    latitude: row.pond_latitude,
    longitude: row.pond_longitude,
    status: row.pond_status,
    notes: row.pond_notes,
    created_at: row.pond_created_at,
  };
  let latest: PondAgreementVersion | null = null;
  if (row.lv_id !== null && row.lv_uuid && row.lv_version !== null) {
    latest = {
      id: row.lv_id,
      pond_id: row.pond_id,
      version: row.lv_version,
      uuid: row.lv_uuid,
      mime: row.lv_mime ?? 'application/octet-stream',
      bytes: row.lv_bytes ?? 0,
      original_filename: row.lv_original_filename,
      notes: row.lv_notes,
      uploaded_at: row.lv_uploaded_at ?? 0,
      uploaded_by: row.lv_uploaded_by ?? 0,
      url: `/api/ponds/agreements/raw/${row.lv_uuid}`,
    };
  }
  return {
    pond,
    farmer,
    village_name: row.village_name,
    latest_agreement: latest,
    agreement_count: row.agreement_count,
  };
}

async function loadPondDetail(db: D1Database, id: number): Promise<PondDetail | null> {
  const row = await db
    .prepare(
      `SELECT
         p.id          AS pond_id,
         p.farmer_id   AS pond_farmer_id,
         p.village_id  AS pond_village_id,
         p.latitude    AS pond_latitude,
         p.longitude   AS pond_longitude,
         p.status      AS pond_status,
         p.notes       AS pond_notes,
         p.created_at  AS pond_created_at,
         f.id          AS farmer_id,
         f.village_id  AS farmer_village_id,
         f.full_name   AS farmer_full_name,
         f.phone       AS farmer_phone,
         f.plot_identifier AS farmer_plot,
         f.created_at  AS farmer_created_at,
         v.name        AS village_name
       FROM pond p
       JOIN farmer f ON f.id = p.farmer_id
       JOIN village v ON v.id = p.village_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .bind(id)
    .first<{
      pond_id: number;
      pond_farmer_id: number;
      pond_village_id: number;
      pond_latitude: number;
      pond_longitude: number;
      pond_status: PondStatus;
      pond_notes: string | null;
      pond_created_at: number;
      farmer_id: number;
      farmer_village_id: number;
      farmer_full_name: string;
      farmer_phone: string | null;
      farmer_plot: string | null;
      farmer_created_at: number;
      village_name: string;
    }>();
  if (!row) return null;

  const versionsRs = await db
    .prepare(
      `SELECT id, pond_id, version, uuid, mime, bytes, original_filename,
              notes, uploaded_at, uploaded_by
         FROM pond_agreement_version
        WHERE pond_id = ?
        ORDER BY version DESC`,
    )
    .bind(id)
    .all<{
      id: number;
      pond_id: number;
      version: number;
      uuid: string;
      mime: string;
      bytes: number;
      original_filename: string | null;
      notes: string | null;
      uploaded_at: number;
      uploaded_by: number;
    }>();

  const agreements: PondAgreementVersion[] = versionsRs.results.map((v) => ({
    id: v.id,
    pond_id: v.pond_id,
    version: v.version,
    uuid: v.uuid,
    mime: v.mime,
    bytes: v.bytes,
    original_filename: v.original_filename,
    notes: v.notes,
    uploaded_at: v.uploaded_at,
    uploaded_by: v.uploaded_by,
    url: `/api/ponds/agreements/raw/${v.uuid}`,
  }));

  return {
    pond: {
      id: row.pond_id,
      farmer_id: row.pond_farmer_id,
      village_id: row.pond_village_id,
      latitude: row.pond_latitude,
      longitude: row.pond_longitude,
      status: row.pond_status,
      notes: row.pond_notes,
      created_at: row.pond_created_at,
    },
    farmer: {
      id: row.farmer_id,
      village_id: row.farmer_village_id,
      full_name: row.farmer_full_name,
      phone: row.farmer_phone,
      plot_identifier: row.farmer_plot,
      created_at: row.farmer_created_at,
    },
    village_name: row.village_name,
    agreements,
  };
}

export default ponds;
