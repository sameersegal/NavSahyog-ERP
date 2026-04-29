// D36 step 6 — outbox replay re-validation against the live
// capability matrix.
//
// The four-layer split (decisions.md D36, layer 4) commits that
// queued mutations are re-validated against the *current* role and
// capability matrix at replay time, not the matrix that was active
// when the mutation was queued. The structural reason this is true
// is that requireAuth + requireCap both load `user.role` from D1
// on every request — there is no session-cached capability list.
// This test pins that property so a future "performance
// optimisation" that caches capabilities on the session row is
// caught immediately.
//
// Concretely:
//   1. Sign in as `vc-anandpur` (vc role; carries `child.write`).
//      Capture the cookie.
//   2. POST a child with that cookie — succeeds (201).
//   3. UPDATE user SET role = 'district_admin' WHERE user_id =
//      'vc-anandpur' (district_admin is read-only — no
//      child.write).
//   4. POST another child with the SAME cookie — must 403.
//
// Step 4's 403 is the proof of the property. If a session-cached
// cap list existed, the second POST would still succeed because
// the cookie was minted while the user was a vc.

import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySchemaAndSeed, loginAs, resetDb } from './setup';

beforeAll(async () => {
  await applySchemaAndSeed(env.DB);
});

beforeEach(resetDb);

async function cookieFetch(path: string, token: string, init: RequestInit = {}) {
  return SELF.fetch(`http://api.test${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie: `nsf_session=${token}`,
      ...(init.headers ?? {}),
    },
  });
}

function childBody(suffix: string) {
  return {
    village_id: 1,
    school_id: 1,
    first_name: `RevalTest${suffix}`,
    last_name: 'Reval',
    gender: 'f' as const,
    dob: '2018-05-12',
    father_name: 'Test Parent',
    father_phone: '9988776655',
    father_has_smartphone: 1 as const,
  };
}

describe('D36 layer-4 — outbox replay re-validates against current capability matrix', () => {
  it('a role demotion between two requests on the same cookie revokes write capability immediately', async () => {
    const token = await loginAs('vc-anandpur');

    // First write succeeds — user is a vc, vc carries child.write.
    const before = await cookieFetch('/api/children', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': '01HZRV0000000000000000000A' },
      body: JSON.stringify(childBody('Before')),
    });
    expect(before.status).toBe(201);

    // Demote the user out-of-band. This is the analogue of an admin
    // changing the role between an offline write being queued and
    // the outbox replaying it after reconnect.
    await env.DB
      .prepare(
        "UPDATE user SET role = 'district_admin', scope_level = 'district', scope_id = 1 WHERE user_id = 'vc-anandpur'",
      )
      .run();

    // Same cookie. Same payload shape. The Worker must reject — the
    // user no longer carries child.write.
    const after = await cookieFetch('/api/children', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': '01HZRV0000000000000000000B' },
      body: JSON.stringify(childBody('After')),
    });
    expect(after.status).toBe(403);
  });

  it('a role promotion between two requests grants newly-acquired capabilities on the next replay', async () => {
    // The mirror property — a user who lacked X at queue-time but
    // has X at replay-time should succeed. This catches the bug of
    // session-time-cached *deny* lists too, not just allow lists.
    const token = await loginAs('district-bid'); // district_admin, read-only.

    // Read-only — write must 403 today.
    const denied = await cookieFetch('/api/children', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': '01HZRV0000000000000000000C' },
      body: JSON.stringify(childBody('Denied')),
    });
    expect(denied.status).toBe(403);

    // Promote to vc — assign to village 1 so scope checks resolve.
    await env.DB
      .prepare(
        "UPDATE user SET role = 'vc', scope_level = 'village', scope_id = 1 WHERE user_id = 'district-bid'",
      )
      .run();

    const granted = await cookieFetch('/api/children', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': '01HZRV0000000000000000000D' },
      body: JSON.stringify(childBody('Granted')),
    });
    expect(granted.status).toBe(201);
  });
});
