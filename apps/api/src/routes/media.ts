// Media routes — presign / PUT receiver / commit / list / get /
// delete. Spec §5.8, §7.
//
// Three-step upload (client view):
//   1. POST /api/media/presign   → { upload_url, r2_key, uuid, exp }
//   2. PUT  <upload_url>         → bytes land in R2
//   3. POST /api/media           → metadata row, server HEADs R2 to
//                                  verify bytes/ETag
//
// L2.4 ships step 2 as an in-Worker proxy so the whole thing runs
// against `wrangler dev --local` (bytes flow through the Worker, into
// the R2 binding). The CLIENT shape is identical to the production
// path, which will swap the upload_url for an AWS4 presigned URL that
// points directly at R2's S3-compatible endpoint — client code
// unchanged. See src/lib/media.ts for the rationale.

import { Hono } from 'hono';
import type {
  Media,
  MediaKind,
  MediaPresignRequest,
  MediaPresignResponse,
  MediaCommitRequest,
  MediaWithUrls,
} from '@navsahyog/shared';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { assertVillageInScope, villageIdsInScope } from '../scope';
import { err } from '../lib/errors';
import { nowEpochSeconds } from '../lib/time';
import {
  MAX_UPLOAD_BYTES,
  PRESIGN_TTL_SECONDS,
  buildR2Key,
  canonicalMime,
  isMimeAllowed,
  isUuid,
  parseKind,
  signUploadToken,
  verifyUploadToken,
} from '../lib/media';
import type { Bindings, Variables } from '../types';

const media = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Auth is applied per-route rather than via `media.use('*',
// requireAuth)` because PUT /upload/:uuid is deliberately
// unauthenticated — it's gated by an HMAC token in the query string,
// matching the presigned-URL model (client effectively replays a
// "presigned" URL; the session cookie doesn't travel with the
// upload).
media.put('/upload/:uuid', async (c) => {
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

  // Content-Type must agree with the signed mime. Client sets this
  // automatically from Blob.type; `canonicalMime` strips codec
  // suffixes (`audio/webm;codecs=opus`) so a MediaRecorder blob
  // that presign'd as `audio/webm` still matches. Without this check
  // a client holding a valid image-token could PUT audio bytes and
  // the committed row's mime would diverge from the R2 object.
  const rawContentType = c.req.header('content-type');
  if (!rawContentType || canonicalMime(rawContentType) !== payload.mime) {
    return err(c, 'bad_request', 400, 'content-type does not match token mime');
  }

  // Replay / duplicate commit guard. If a media row with this uuid
  // already exists, a PUT would silently overwrite the R2 object the
  // committed row points at. Reject with 409 so the client knows to
  // use a fresh uuid. Replay-before-commit (no row yet) is still
  // allowed — harmless, writes the same key with the same token-
  // bound mime.
  const existing = await c.env.DB
    .prepare('SELECT id FROM media WHERE uuid = ?')
    .bind(payload.uuid)
    .first<{ id: number }>();
  if (existing) {
    return err(c, 'conflict', 409, 'media with this uuid is already committed');
  }

  // Size is enforced in two places: the token's max_bytes (baked in
  // at presign, matches what the client asked for) and the 50 MiB
  // hard cap (D7). Belt-and-braces: a caller who somehow forged a
  // larger max_bytes still can't exceed the hard cap.
  const body = await c.req.arrayBuffer();
  if (body.byteLength > payload.max_bytes || body.byteLength > MAX_UPLOAD_BYTES) {
    return err(c, 'bad_request', 413, 'payload exceeds cap');
  }

  await c.env.MEDIA.put(payload.r2_key, body, {
    httpMetadata: { contentType: payload.mime },
    customMetadata: {
      uploaded_by: String(payload.user_id),
      village_id: String(payload.village_id),
      kind: payload.kind,
    },
  });

  return c.json({ ok: true, bytes: body.byteLength });
});

// ---- presign ------------------------------------------------------

media.post('/presign', requireAuth, requireCap('media.write'), async (c) => {
  const secret = c.env.MEDIA_PRESIGN_SECRET;
  if (!secret) return err(c, 'internal_error', 500, 'presign secret not configured');
  const user = c.get('user');
  const body = await c.req
    .json<MediaPresignRequest>()
    .catch(() => ({}) as MediaPresignRequest);

  if (!isUuid(body.uuid)) {
    return err(c, 'bad_request', 400, 'uuid must be a UUIDv4');
  }
  const kind = parseKind(body.kind);
  if (!kind) return err(c, 'bad_request', 400, 'kind must be image|video|audio');
  if (typeof body.mime !== 'string' || !isMimeAllowed(kind, body.mime)) {
    return err(c, 'bad_request', 400, `mime not allowed for kind=${kind}`);
  }
  if (!Number.isInteger(body.bytes) || body.bytes <= 0) {
    return err(c, 'bad_request', 400, 'bytes must be a positive integer');
  }
  if (body.bytes > MAX_UPLOAD_BYTES) {
    return err(c, 'bad_request', 413, `bytes exceeds 50 MiB cap`);
  }
  const villageId = Number(body.village_id);
  if (!villageId) {
    return err(c, 'bad_request', 400, 'village_id required');
  }
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return err(c, 'forbidden', 403);
  }
  const capturedAt = Number(body.captured_at);
  if (!Number.isInteger(capturedAt) || capturedAt <= 0) {
    return err(c, 'bad_request', 400, 'captured_at must be a positive epoch');
  }

  const r2Key = buildR2Key({
    kind,
    uuid: body.uuid,
    mime: body.mime,
    villageId,
    capturedAtEpoch: capturedAt,
  });

  const now = nowEpochSeconds();
  const expiresAt = now + PRESIGN_TTL_SECONDS;

  const token = await signUploadToken(secret, {
    uuid: body.uuid,
    r2_key: r2Key,
    kind,
    mime: body.mime,
    max_bytes: body.bytes,
    village_id: villageId,
    user_id: user.id,
    exp: expiresAt,
  });

  // Relative URL — the client resolves against its current origin so
  // dev (localhost:8787) and prod (api.navsahyog.org) both work
  // without the server knowing its own hostname.
  const uploadUrl = `/api/media/upload/${body.uuid}?token=${encodeURIComponent(token)}`;

  const response: MediaPresignResponse = {
    uuid: body.uuid,
    r2_key: r2Key,
    upload_url: uploadUrl,
    upload_method: 'PUT',
    expires_at: expiresAt,
  };
  return c.json(response);
});

// ---- commit -------------------------------------------------------

media.post('/', requireAuth, requireCap('media.write'), async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<MediaCommitRequest>()
    .catch(() => ({}) as MediaCommitRequest);

  if (!isUuid(body.uuid)) {
    return err(c, 'bad_request', 400, 'uuid required');
  }
  const kind = parseKind(body.kind);
  if (!kind) return err(c, 'bad_request', 400, 'kind must be image|video|audio');
  if (typeof body.mime !== 'string' || !isMimeAllowed(kind, body.mime)) {
    return err(c, 'bad_request', 400, `mime not allowed for kind=${kind}`);
  }
  if (typeof body.r2_key !== 'string' || !body.r2_key) {
    return err(c, 'bad_request', 400, 'r2_key required');
  }
  if (!Number.isInteger(body.bytes) || body.bytes <= 0) {
    return err(c, 'bad_request', 400, 'bytes must be a positive integer');
  }
  if (body.bytes > MAX_UPLOAD_BYTES) {
    return err(c, 'bad_request', 413, `bytes exceeds 50 MiB cap`);
  }
  const capturedAt = Number(body.captured_at);
  if (!Number.isInteger(capturedAt) || capturedAt <= 0) {
    return err(c, 'bad_request', 400, 'captured_at must be a positive epoch');
  }
  const villageId = Number(body.village_id);
  if (!villageId) return err(c, 'bad_request', 400, 'village_id required');
  if (!(await assertVillageInScope(c.env.DB, user, villageId))) {
    return err(c, 'forbidden', 403);
  }

  // Optional tag: must refer to a real row in `event` if supplied.
  let tagEventId: number | null = null;
  if (body.tag_event_id !== undefined && body.tag_event_id !== null) {
    tagEventId = Number(body.tag_event_id);
    if (!Number.isInteger(tagEventId) || tagEventId <= 0) {
      return err(c, 'bad_request', 400, 'tag_event_id must be positive');
    }
    const evt = await c.env.DB
      .prepare('SELECT id FROM event WHERE id = ?')
      .bind(tagEventId)
      .first<{ id: number }>();
    if (!evt) return err(c, 'bad_request', 400, 'unknown tag_event_id');
  }

  // GPS: accept null or float pair. No range check — a bad value is
  // a client bug, not something we should swallow.
  const latitude =
    body.latitude === undefined || body.latitude === null
      ? null
      : Number(body.latitude);
  const longitude =
    body.longitude === undefined || body.longitude === null
      ? null
      : Number(body.longitude);
  if (latitude !== null && !Number.isFinite(latitude)) {
    return err(c, 'bad_request', 400, 'latitude must be numeric or null');
  }
  if (longitude !== null && !Number.isFinite(longitude)) {
    return err(c, 'bad_request', 400, 'longitude must be numeric or null');
  }

  // Verify the object landed in R2 at the claimed key and size —
  // step 5 of §7.3. A commit against a missing key means the PUT
  // failed or the client lied; either way the row shouldn't exist.
  const head = await c.env.MEDIA.head(body.r2_key);
  if (!head) {
    return err(c, 'bad_request', 400, 'object not present in R2');
  }
  if (head.size !== body.bytes) {
    return err(c, 'bad_request', 400, 'byte count mismatch with R2');
  }

  const now = nowEpochSeconds();

  // Idempotency: if a row with this uuid already exists (client
  // retried commit after a transient network failure), return the
  // existing row rather than erroring out.
  const existing = await c.env.DB
    .prepare('SELECT id FROM media WHERE uuid = ?')
    .bind(body.uuid)
    .first<{ id: number }>();
  if (existing) {
    const fresh = await loadMediaWithUrls(c.env, existing.id);
    if (!fresh) return err(c, 'internal_error', 500);
    return c.json({ media: fresh }, 200);
  }

  const inserted = await c.env.DB
    .prepare(
      `INSERT INTO media
         (uuid, kind, r2_key, mime, bytes, captured_at, received_at,
          latitude, longitude, village_id, tag_event_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      body.uuid,
      kind,
      body.r2_key,
      body.mime,
      body.bytes,
      capturedAt,
      now,
      latitude,
      longitude,
      villageId,
      tagEventId,
      user.id,
    )
    .first<{ id: number }>();
  if (!inserted) return err(c, 'internal_error', 500, 'insert failed');

  const fresh = await loadMediaWithUrls(c.env, inserted.id);
  if (!fresh) return err(c, 'internal_error', 500);
  return c.json({ media: fresh }, 201);
});

// ---- list / get / delete -----------------------------------------

media.get('/', requireAuth, requireCap('media.read'), async (c) => {
  const user = c.get('user');
  const villageParam = c.req.query('village_id');
  const kindParam = c.req.query('kind');
  const kind = kindParam ? parseKind(kindParam) : null;
  if (kindParam && !kind) {
    return err(c, 'bad_request', 400, 'kind must be image|video|audio');
  }

  const from = Number(c.req.query('from') ?? 0);
  const to = Number(c.req.query('to') ?? 0);

  const scopeIds = await villageIdsInScope(c.env.DB, user);
  if (scopeIds.length === 0) return c.json({ media: [] });

  const filterVillage = villageParam ? Number(villageParam) : null;
  if (filterVillage !== null) {
    if (!scopeIds.includes(filterVillage)) {
      return err(c, 'forbidden', 403);
    }
  }

  const villageIds = filterVillage ? [filterVillage] : scopeIds;
  const placeholders = villageIds.map(() => '?').join(',');
  const clauses: string[] = [
    `m.village_id IN (${placeholders})`,
    'm.deleted_at IS NULL',
  ];
  const params: unknown[] = [...villageIds];
  if (kind) { clauses.push('m.kind = ?'); params.push(kind); }
  if (from > 0) { clauses.push('m.captured_at >= ?'); params.push(from); }
  if (to > 0)   { clauses.push('m.captured_at <= ?'); params.push(to); }

  const rs = await c.env.DB
    .prepare(
      `SELECT * FROM media m
       WHERE ${clauses.join(' AND ')}
       ORDER BY m.captured_at DESC, m.id DESC
       LIMIT 200`,
    )
    .bind(...params)
    .all<Media>();

  const items = await Promise.all(
    rs.results.map(async (row) => withUrls(c.env, row)),
  );
  return c.json({ media: items });
});

media.get('/:id', requireAuth, requireCap('media.read'), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const row = await loadMedia(c.env.DB, id);
  if (!row) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, row.village_id))) {
    return err(c, 'forbidden', 403);
  }
  const full = await withUrls(c.env, row);
  return c.json({ media: full });
});

media.delete('/:id', requireAuth, requireCap('media.write'), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!id) return err(c, 'bad_request', 400, 'id required');
  const row = await loadMedia(c.env.DB, id);
  if (!row) return err(c, 'not_found', 404);
  if (!(await assertVillageInScope(c.env.DB, user, row.village_id))) {
    return err(c, 'forbidden', 403);
  }
  const now = nowEpochSeconds();
  await c.env.DB
    .prepare('UPDATE media SET deleted_at = ?, deleted_by = ? WHERE id = ?')
    .bind(now, user.id, id)
    .run();
  return c.json({ ok: true });
});

// ---- helpers ------------------------------------------------------

async function loadMedia(db: D1Database, id: number): Promise<Media | null> {
  return (
    (await db
      .prepare('SELECT * FROM media WHERE id = ? AND deleted_at IS NULL')
      .bind(id)
      .first<Media>()) ?? null
  );
}

async function loadMediaWithUrls(
  env: Bindings,
  id: number,
): Promise<MediaWithUrls | null> {
  const row = await loadMedia(env.DB, id);
  return row ? withUrls(env, row) : null;
}

// Read-side URL minting. L2.4 returns a worker-relative read path
// rather than an S3 presigned GET; the shape matches the eventual
// presigned-URL world (client still does `fetch(url)`), and the
// thumb_url falls back to the same key until the derive queue ships
// (decisions.md D11). Callers attach the session cookie, so scope is
// enforced via /api/media/raw/:uuid below rather than by URL secret.
function withUrls(_env: Bindings, row: Media): MediaWithUrls {
  const url = `/api/media/raw/${row.uuid}`;
  return { ...row, url, thumb_url: url };
}

// Authenticated read-through: streams bytes from R2 via the Worker
// binding. Matches the contract the presigned GET URL will expose in
// production; for local dev this is the only way to read the
// filesystem-backed R2 emulator. Scope check uses the session user,
// matching the list endpoint.
media.get('/raw/:uuid', requireAuth, requireCap('media.read'), async (c) => {
  const user = c.get('user');
  const uuid = c.req.param('uuid');
  if (!isUuid(uuid)) return err(c, 'bad_request', 400, 'uuid required');
  const row = await c.env.DB
    .prepare('SELECT * FROM media WHERE uuid = ? AND deleted_at IS NULL')
    .bind(uuid)
    .first<Media>();
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

export default media;
