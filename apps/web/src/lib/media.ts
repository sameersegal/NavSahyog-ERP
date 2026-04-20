// Media upload helper: orchestrates the three-step presign → PUT →
// commit flow against /api/media/*. Single entry point for every
// caller (child photo picker, voice-note recorder, /capture page)
// so the tag / GPS / error handling stays consistent.
//
// L2.4 scope (decisions.md D7–D11):
//   * Single-PUT path, 50 MiB raw cap enforced client-side with a
//     matching server check (belt-and-braces).
//   * No client transcode (D8). Video > cap is refused with a clear
//     error; user retakes at lower quality.
//   * GPS via navigator.geolocation. EXIF extraction from source
//     JPEGs is an L2.4b follow-up — the spec prefers EXIF GPS but
//     the fallback is sufficient for MVP because every in-app
//     capture hits geolocation fresh.
//   * Server trusts the body GPS; container-metadata sidecar (MP4
//     `©xyz`) is skipped per D10.
//
// The helper returns a minimal `{ id, uuid, bytes }` once the row is
// committed; callers pass `id` to children / attendance / capture
// POSTs to attach the upload.

import type {
  MediaKind,
  MediaPresignRequest,
  MediaPresignResponse,
  MediaWithUrls,
} from '@navsahyog/shared';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;   // 50 MiB (D7)
export const GEOLOCATION_TIMEOUT_MS = 8_000;

// ---- low-level API calls -----------------------------------------

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as {
      error?: { code?: string; message?: string };
    };
    throw new Error(
      body.error?.message ?? body.error?.code ?? `HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<T>(res);
}

export async function presignMedia(
  req: MediaPresignRequest,
): Promise<MediaPresignResponse> {
  return postJSON<MediaPresignResponse>('/api/media/presign', req);
}

export async function commitMedia(body: {
  uuid: string;
  kind: MediaKind;
  r2_key: string;
  mime: string;
  bytes: number;
  captured_at: number;
  village_id: number;
  latitude?: number | null;
  longitude?: number | null;
  tag_event_id?: number | null;
}): Promise<MediaWithUrls> {
  const res = await postJSON<{ media: MediaWithUrls }>('/api/media', body);
  return res.media;
}

export async function deleteMedia(id: number): Promise<void> {
  const res = await fetch(`/api/media/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await jsonOrThrow(res);
}

// ---- geolocation -------------------------------------------------

// Best-effort. Null on decline / unsupported / timeout — a null
// location is permitted by §7.8 (and then flagged server-side).
export async function captureGps(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

// ---- upload ------------------------------------------------------

export type UploadInput = {
  file: Blob;
  kind: MediaKind;
  villageId: number;
  capturedAt?: number;                  // UTC epoch seconds; defaults to now
  tagEventId?: number | null;
  gps?: { latitude: number; longitude: number } | null;
  // `mime` override: MediaRecorder's Blob.type sometimes has a codec
  // suffix (`audio/webm;codecs=opus`) the server rejects. Callers
  // pass the canonical MIME explicitly.
  mime?: string;
};

export type UploadResult = {
  id: number;
  uuid: string;
  bytes: number;
  url: string;
  thumb_url: string;
  mime: string;
};

// Full flow: pre-flight caps → presign → PUT → commit. Any step's
// failure surfaces as a thrown Error with the server-provided
// message; callers show it to the user and keep the file around so
// they can retry.
export async function uploadMedia(input: UploadInput): Promise<UploadResult> {
  const mime = input.mime ?? input.file.type;
  if (!mime) throw new Error('missing MIME type');
  if (input.file.size <= 0) throw new Error('empty file');
  if (input.file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `file is ${(input.file.size / (1024 * 1024)).toFixed(1)} MiB, cap is 50 MiB`,
    );
  }

  const uuid = crypto.randomUUID();
  const capturedAt = input.capturedAt ?? Math.floor(Date.now() / 1000);

  const presign = await presignMedia({
    uuid,
    kind: input.kind,
    mime,
    bytes: input.file.size,
    village_id: input.villageId,
    captured_at: capturedAt,
  });

  // The presigned URL is relative; fetch() resolves it against the
  // current origin so dev (Vite proxy) and prod both work.
  const putRes = await fetch(presign.upload_url, {
    method: 'PUT',
    // No credentials — the HMAC token carries the authorisation.
    // Dropping the cookie also avoids a CORS preflight in prod
    // (the token-gated endpoint is not same-site in a custom-
    // domain deploy, so a cookie would force withCredentials).
    body: input.file,
  });
  if (!putRes.ok) {
    throw new Error(`upload failed (${putRes.status})`);
  }

  const commit = await commitMedia({
    uuid,
    kind: input.kind,
    r2_key: presign.r2_key,
    mime,
    bytes: input.file.size,
    captured_at: capturedAt,
    village_id: input.villageId,
    latitude: input.gps?.latitude ?? null,
    longitude: input.gps?.longitude ?? null,
    tag_event_id: input.tagEventId ?? null,
  });

  return {
    id: commit.id,
    uuid: commit.uuid,
    bytes: commit.bytes,
    url: commit.url,
    thumb_url: commit.thumb_url,
    mime: commit.mime,
  };
}

// ---- MIME canonicalisation ---------------------------------------

// MediaRecorder emits types like `audio/webm;codecs=opus`; the
// server allow-list matches on the bare MIME. Strip the codec
// suffix before upload.
export function canonicalMime(type: string): string {
  return type.split(';')[0]?.trim() ?? '';
}
