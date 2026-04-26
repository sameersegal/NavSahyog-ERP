// Pond-agreement upload helper. Mirrors lib/media.ts but for the
// Jal Vriddhi PDF / image scans (§3.10).
//
// Two-phase: presign → PUT. The "commit" step happens inline with
// either POST /api/ponds (initial create) or POST
// /api/ponds/:id/agreements (append a new version), so this helper
// only stages the bytes in R2 and returns the metadata the caller
// hands to the create / append endpoint.

import {
  AGREEMENT_MAX_BYTES,
  AGREEMENT_MIMES,
  type AgreementCommitRef,
  type AgreementPresignResponse,
} from '@navsahyog/shared';

export { AGREEMENT_MAX_BYTES, AGREEMENT_MIMES };

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new Error(
      body.error?.message ?? body.error?.code ?? `HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export async function presignAgreement(req: {
  uuid: string;
  mime: string;
  bytes: number;
  village_id: number;
}): Promise<AgreementPresignResponse> {
  const res = await fetch('/api/ponds/agreements/presign', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return jsonOrThrow<AgreementPresignResponse>(res);
}

export type StagedAgreement = AgreementCommitRef;

// Browsers report `application/pdf` consistently; image scans land
// as `image/jpeg` / `image/png` from a `<input type=file>` picker.
// Strip any stray `; charset=…` parameters before comparing against
// the allow-list (matches the server's canonicalMime).
export function canonicalMime(type: string): string {
  return type.split(';')[0]?.trim() ?? '';
}

export function isAgreementMime(mime: string): boolean {
  return (AGREEMENT_MIMES as readonly string[]).includes(mime);
}

export async function uploadAgreement(input: {
  file: File;
  villageId: number;
  notes?: string | null;
}): Promise<StagedAgreement> {
  const mime = canonicalMime(input.file.type) || 'application/octet-stream';
  if (!isAgreementMime(mime)) {
    throw new Error(`agreement must be PDF, JPEG, or PNG (got ${mime})`);
  }
  if (input.file.size <= 0) throw new Error('empty file');
  if (input.file.size > AGREEMENT_MAX_BYTES) {
    throw new Error(
      `agreement is ${(input.file.size / (1024 * 1024)).toFixed(1)} MiB, cap is 25 MiB`,
    );
  }
  const uuid = crypto.randomUUID();

  const presign = await presignAgreement({
    uuid,
    mime,
    bytes: input.file.size,
    village_id: input.villageId,
  });

  const putRes = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    // Like media: no credentials — the HMAC token in the query
    // string carries authorisation, and a cookie would force a
    // cross-origin preflight in custom-domain deploys.
    body: input.file,
  });
  if (!putRes.ok) {
    throw new Error(`agreement upload failed (${putRes.status})`);
  }

  return {
    uuid,
    r2_key: presign.r2_key,
    mime,
    bytes: input.file.size,
    original_filename: input.file.name || null,
    notes: input.notes ?? null,
  };
}
