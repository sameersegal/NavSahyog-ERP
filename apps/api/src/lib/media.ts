// Media helpers — MIME / kind mapping, size caps, upload-token
// HMAC sign/verify, R2 key layout. Single source of truth that the
// media route + tests import from.
//
// L2.4 scope (decisions.md D7–D11):
//   * Uniform 50 MiB cap across all kinds; multipart is L2.4b.
//   * Local upload path: client PUTs to a Worker endpoint whose URL
//     was returned by /api/media/presign. The Worker validates the
//     HMAC token, streams bytes to the R2 binding. This keeps the
//     CLIENT's two-phase (presign → PUT → commit) shape identical to
//     the final production flow, where AWS4 presigned URLs point
//     directly at R2's S3-compatible endpoint and bytes bypass the
//     Worker entirely (spec §7.3, §8.13 "≤ 2 KiB through Worker per
//     upload"). Swapping the URL source swaps the dev/prod story
//     without touching client code. See routes/media.ts for the
//     proxy endpoint.
//
// Token design: HMAC-SHA256 over a minimal JSON payload, signed with
// MEDIA_PRESIGN_SECRET. Short-lived (15 min, matches §5.8). Not JWT
// because we don't need the surface: no nested claims, no third-party
// verifiers, no rotation story yet (§11.9 covers that when we deploy).

import type { MediaKind } from '@navsahyog/shared';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MiB, per D7
export const PRESIGN_TTL_SECONDS = 15 * 60;

// MIME allow-list per kind. Superset of the spec's §7.2 list plus the
// browser-native MediaRecorder outputs we hit on Chrome (webm audio,
// webm video). We keep those in the allow-list rather than forcing
// the client into an MP4 transcode — that's the L2.4b transcode work
// (decisions.md D8).
const KIND_MIMES: Record<MediaKind, readonly string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/webm'],
  audio: ['audio/mp4', 'audio/ogg', 'audio/webm', 'audio/mpeg'],
};

// File extension per MIME. Used to build the R2 key (spec §7.1). When
// the MIME isn't in the table we fall back to 'bin'; the allow-list
// check below ensures that path never runs with a legit upload.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'audio/mpeg': 'mp3',
};

const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseKind(raw: unknown): MediaKind | null {
  return typeof raw === 'string' && (MEDIA_KINDS as readonly string[]).includes(raw)
    ? (raw as MediaKind)
    : null;
}

export function isMimeAllowed(kind: MediaKind, mime: string): boolean {
  return KIND_MIMES[kind].includes(mime);
}

export function extFor(mime: string): string {
  return MIME_EXT[mime] ?? 'bin';
}

export function isUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw);
}

// R2 key: `{kind}/{yyyy}/{mm}/{dd}/{village_id}/{uuid}.{ext}` (spec
// §7.1). Date prefix keeps R2 listings cheap for retention sweeps;
// village prefix aids per-village reporting. We use village_id
// (integer) rather than village_uuid because the bespoke schema has
// no village_uuid column yet — the spec's uuid is forward-compatible
// guidance that returns when uuids are added broadly.
export function buildR2Key(params: {
  kind: MediaKind;
  uuid: string;
  mime: string;
  villageId: number;
  capturedAtEpoch: number;
}): string {
  const d = new Date(params.capturedAtEpoch * 1000);
  const yyyy = d.getUTCFullYear().toString();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${params.kind}/${yyyy}/${mm}/${dd}/${params.villageId}/${params.uuid}.${extFor(params.mime)}`;
}

// ---- upload tokens ------------------------------------------------

export type UploadTokenPayload = {
  uuid: string;
  r2_key: string;
  kind: MediaKind;
  mime: string;
  max_bytes: number;
  village_id: number;
  user_id: number;
  exp: number;
};

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(s.length / 4) * 4,
    '=',
  );
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signUploadToken(
  secret: string,
  payload: UploadTokenPayload,
): Promise<string> {
  const body = toB64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
  );
  return `${body}.${toB64Url(sig)}`;
}

// Returns payload on success, null on any failure (malformed, bad
// signature, expired). Callers always return 401 / 403 on null —
// don't leak which of the three it was.
export async function verifyUploadToken(
  secret: string,
  token: string,
  nowEpoch: number,
): Promise<UploadTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sigB64] = parts as [string, string];
  const key = await hmacKey(secret);
  let sigBytes: Uint8Array;
  try {
    sigBytes = fromB64Url(sigB64);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes as BufferSource,
    new TextEncoder().encode(body),
  );
  if (!ok) return null;
  let payload: UploadTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64Url(body)));
  } catch {
    return null;
  }
  if (payload.exp < nowEpoch) return null;
  return payload;
}
