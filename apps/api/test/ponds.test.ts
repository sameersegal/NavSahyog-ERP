// Jal Vriddhi pond agreement tests (§3.10, decisions.md D25–D28).
//
// Covers:
//   * Capability gate — read-only geo admin can list but not create.
//   * Full create flow: presign → PUT → POST /api/ponds → version 1.
//   * Append flow: a second presign → PUT → POST /:id/agreements
//     produces version 2; full history readable; old versions kept.
//   * Idempotency-style guard: re-using a uuid returns 409.
//   * Scope check: an out-of-scope village on presign returns 403.

import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySchemaAndSeed, loginAs, resetDb } from './setup';

beforeAll(async () => {
  await applySchemaAndSeed(env.DB);
});

async function cookieFetch(
  path: string,
  token: string,
  init: RequestInit = {},
) {
  return SELF.fetch(`http://api.test${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie: `nsf_session=${token}`,
      ...(init.headers ?? {}),
    },
  });
}

// Tiny PDF magic (`%PDF-1.4`), enough for a happy-path R2 round-trip.
const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00,
]);

async function presignAgreement(
  token: string,
  body: Record<string, unknown>,
) {
  const res = await cookieFetch('/api/ponds/agreements/presign', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() as Record<string, unknown> };
}

async function stageAgreement(
  token: string,
  villageId: number,
  bytes: Uint8Array = PDF_BYTES,
) {
  const uuid = crypto.randomUUID();
  const p = await presignAgreement(token, {
    uuid,
    mime: 'application/pdf',
    bytes: bytes.byteLength,
    village_id: villageId,
  });
  expect(p.status).toBe(200);
  const uploadUrl = p.data.upload_url as string;
  expect(uploadUrl).toMatch(/^\/api\/ponds\/agreements\/upload\/[0-9a-f-]+\?token=/);
  const putRes = await SELF.fetch(`http://api.test${uploadUrl}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: bytes,
  });
  expect(putRes.status).toBe(200);
  return {
    uuid,
    r2_key: p.data.r2_key as string,
    mime: 'application/pdf',
    bytes: bytes.byteLength,
  };
}

describe('ponds — capability + scope gates', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('a read-only district admin can list but cannot presign', async () => {
    const adminToken = await loginAs('district-bid');
    const list = await cookieFetch('/api/ponds', adminToken);
    expect(list.status).toBe(200);
    const presign = await presignAgreement(adminToken, {
      uuid: crypto.randomUUID(),
      mime: 'application/pdf',
      bytes: 100,
      village_id: 1,
    });
    expect(presign.status).toBe(403);
  });

  it('presign against a sibling village returns 403', async () => {
    const token = await loginAs('vc-anandpur');
    // vc-anandpur owns village 1; village 2 is the sibling Belur.
    const res = await presignAgreement(token, {
      uuid: crypto.randomUUID(),
      mime: 'application/pdf',
      bytes: 100,
      village_id: 2,
    });
    expect(res.status).toBe(403);
  });

  it('presign rejects disallowed MIMEs', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await presignAgreement(token, {
      uuid: crypto.randomUUID(),
      mime: 'video/mp4',
      bytes: 100,
      village_id: 1,
    });
    expect(res.status).toBe(400);
  });
});

describe('ponds — create flow (D26 versioning)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('full round-trip creates farmer + pond + version 1', async () => {
    const token = await loginAs('vc-anandpur');
    const staged = await stageAgreement(token, 1);

    const res = await cookieFetch('/api/ponds', token, {
      method: 'POST',
      body: JSON.stringify({
        farmer: {
          village_id: 1,
          full_name: 'Ramesh Kumar',
          phone: '+919876543210',
          plot_identifier: 'Survey No. 42/3',
        },
        pond: {
          latitude: 12.971599,
          longitude: 77.594566,
          status: 'planned',
          notes: 'On the south edge of the plot.',
        },
        agreement: {
          ...staged,
          original_filename: 'agreement.pdf',
          notes: 'Initial signing.',
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      pond: {
        pond: { id: number; latitude: number; status: string };
        farmer: { full_name: string; phone: string | null };
        agreements: Array<{ version: number; uuid: string }>;
      };
    };
    expect(body.pond.pond.latitude).toBe(12.971599);
    expect(body.pond.pond.status).toBe('planned');
    expect(body.pond.farmer.full_name).toBe('Ramesh Kumar');
    expect(body.pond.farmer.phone).toBe('+919876543210');
    expect(body.pond.agreements).toHaveLength(1);
    expect(body.pond.agreements[0]?.version).toBe(1);
  });

  it('append-agreement round-trip produces version 2 alongside version 1', async () => {
    const token = await loginAs('vc-anandpur');
    const staged1 = await stageAgreement(token, 1);
    const created = await cookieFetch('/api/ponds', token, {
      method: 'POST',
      body: JSON.stringify({
        farmer: { village_id: 1, full_name: 'Ramesh Kumar' },
        pond: { latitude: 12.97, longitude: 77.59 },
        agreement: { ...staged1, original_filename: 'v1.pdf' },
      }),
    });
    expect(created.status).toBe(201);
    const pondId = ((await created.json()) as { pond: { pond: { id: number } } })
      .pond.pond.id;

    const staged2 = await stageAgreement(token, 1, new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x01, 0x02,
    ]));
    const append = await cookieFetch(`/api/ponds/${pondId}/agreements`, token, {
      method: 'POST',
      body: JSON.stringify({
        ...staged2,
        original_filename: 'v2.pdf',
        notes: 'Renewal for 2026.',
      }),
    });
    expect(append.status).toBe(201);
    const detail = ((await append.json()) as {
      pond: { agreements: Array<{ version: number; original_filename: string | null; notes: string | null }> };
    }).pond;
    expect(detail.agreements).toHaveLength(2);
    // Versions descending — newest first.
    expect(detail.agreements.map((a) => a.version)).toEqual([2, 1]);
    expect(detail.agreements[0]?.original_filename).toBe('v2.pdf');
    expect(detail.agreements[0]?.notes).toBe('Renewal for 2026.');
  });

  it('rejects an agreement uuid that has already been committed', async () => {
    const token = await loginAs('vc-anandpur');
    const staged = await stageAgreement(token, 1);
    const first = await cookieFetch('/api/ponds', token, {
      method: 'POST',
      body: JSON.stringify({
        farmer: { village_id: 1, full_name: 'Replay Farmer' },
        pond: { latitude: 12.97, longitude: 77.59 },
        agreement: { ...staged },
      }),
    });
    expect(first.status).toBe(201);

    // Re-using the same uuid+r2_key on a second pond is a client bug
    // — the server refuses it with 400 (uuid already committed).
    const second = await cookieFetch('/api/ponds', token, {
      method: 'POST',
      body: JSON.stringify({
        farmer: { village_id: 1, full_name: 'Replay Farmer 2' },
        pond: { latitude: 13.0, longitude: 77.6 },
        agreement: { ...staged },
      }),
    });
    expect(second.status).toBe(400);
  });
});

describe('ponds — list + detail', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('list returns scope-filtered ponds with farmer + latest version inline', async () => {
    const vcToken = await loginAs('vc-anandpur');
    const staged = await stageAgreement(vcToken, 1);
    await cookieFetch('/api/ponds', vcToken, {
      method: 'POST',
      body: JSON.stringify({
        farmer: { village_id: 1, full_name: 'Latest VC Farmer' },
        pond: { latitude: 12.0, longitude: 77.0 },
        agreement: { ...staged },
      }),
    });

    // VC sees their village only.
    const vcList = await cookieFetch('/api/ponds', vcToken);
    expect(vcList.status).toBe(200);
    const vcBody = await vcList.json() as {
      ponds: Array<{
        farmer: { full_name: string };
        latest_agreement: { version: number } | null;
        agreement_count: number;
      }>;
    };
    expect(vcBody.ponds.length).toBe(1);
    expect(vcBody.ponds[0]?.farmer.full_name).toBe('Latest VC Farmer');
    expect(vcBody.ponds[0]?.latest_agreement?.version).toBe(1);
    expect(vcBody.ponds[0]?.agreement_count).toBe(1);

    // A VC from a sibling village sees an empty list.
    const otherToken = await loginAs('vc-belur');
    const otherList = await cookieFetch('/api/ponds', otherToken);
    expect(otherList.status).toBe(200);
    const otherBody = await otherList.json() as { ponds: unknown[] };
    expect(otherBody.ponds).toHaveLength(0);
  });
});
