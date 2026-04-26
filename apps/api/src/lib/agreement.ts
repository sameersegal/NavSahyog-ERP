// Agreement-upload helpers — MIME / size caps, R2 key layout, HMAC
// upload tokens. Parallel to lib/media.ts but for the Jal Vriddhi
// pond agreements (§3.10, §7).
//
// Why a separate token machinery and not a generalisation of the
// media token: the media token signs `kind` (image/video/audio) and
// `village_id`, both of which are media-specific. Agreements have
// no `kind`, sign `village_id` only as the scope anchor, and a
// shorter MIME allow-list (PDF + image scans). Two narrow tokens
// stay easier to reason about than one generic "upload" token.

import { AGREEMENT_MAX_BYTES, AGREEMENT_MIMES } from '@navsahyog/shared';

export const AGREEMENT_PRESIGN_TTL_SECONDS = 15 * 60;
export { AGREEMENT_MAX_BYTES, AGREEMENT_MIMES };

const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_RE.test(raw);
}

export function isAgreementMimeAllowed(mime: string): boolean {
  return (AGREEMENT_MIMES as readonly string[]).includes(mime);
}

export function extFor(mime: string): string {
  return MIME_EXT[mime] ?? 'bin';
}

// MediaRecorder-style codec suffixes don't apply to agreement files
// (PDF / JPEG / PNG are stable MIMEs), but a stray `; charset=…` from
// a fetch wrapper would still break the allow-list compare. Strip
// any trailing parameters before validation.
export function canonicalMime(type: string): string {
  return type.split(';')[0]?.trim() ?? '';
}

// R2 key: `agreement/{yyyy}/{mm}/{village_id}/{uuid}.{ext}` (§7.1
// shape). Agreements use month-bucket prefixes (no day) because
// volume is far lower than media — month is enough for a retention
// listing. The `agreement/` top-level prefix keeps them out of the
// `image/`, `video/`, `audio/` listings the media route walks.
export function buildR2Key(params: {
  uuid: string;
  mime: string;
  villageId: number;
  uploadedAtEpoch: number;
}): string {
  const d = new Date(params.uploadedAtEpoch * 1000);
  const yyyy = d.getUTCFullYear().toString();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `agreement/${yyyy}/${mm}/${params.villageId}/${params.uuid}.${extFor(params.mime)}`;
}

// ---- upload tokens ------------------------------------------------

export type AgreementUploadTokenPayload = {
  uuid: string;
  r2_key: string;
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

// Distinct version marker from the media token (`v1`) so a client
// can't replay a media-presign token against the agreement endpoint
// or vice versa, even if the secret is shared.
const TOKEN_VERSION = 'agreement-v1';

function serialisePayload(p: AgreementUploadTokenPayload): string {
  return [
    TOKEN_VERSION,
    p.uuid,
    p.r2_key,
    p.mime,
    p.max_bytes,
    p.village_id,
    p.user_id,
    p.exp,
  ].join('|');
}

export async function signUploadToken(
  secret: string,
  payload: AgreementUploadTokenPayload,
): Promise<string> {
  const body = toB64Url(new TextEncoder().encode(serialisePayload(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
  );
  return `${body}.${toB64Url(sig)}`;
}

export async function verifyUploadToken(
  secret: string,
  token: string,
  nowEpoch: number,
): Promise<AgreementUploadTokenPayload | null> {
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
  let raw: string;
  try {
    raw = new TextDecoder().decode(fromB64Url(body));
  } catch {
    return null;
  }
  const fields = raw.split('|');
  if (fields.length !== 8) return null;
  const [version, uuid, r2_key, mime, maxBytesStr, villageStr, userStr, expStr] =
    fields as [string, string, string, string, string, string, string, string];
  if (version !== TOKEN_VERSION) return null;
  const max_bytes = Number(maxBytesStr);
  const village_id = Number(villageStr);
  const user_id = Number(userStr);
  const exp = Number(expStr);
  if (!Number.isFinite(max_bytes) || !Number.isFinite(village_id) ||
      !Number.isFinite(user_id) || !Number.isFinite(exp)) {
    return null;
  }
  if (exp < nowEpoch) return null;
  return { uuid, r2_key, mime, max_bytes, village_id, user_id, exp };
}
