// L3.1 Master Creations (decisions.md D21–D24).
//
// Covers POST/PATCH for villages, schools, events, qualifications,
// and users — and the §2.3 read-only gate via the policy layer.
// `event.kind` immutability lives here because that's where the H5
// fix takes hold (review-findings-v1.md).

import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySchemaAndSeed, loginAs, resetDb } from './setup';

beforeAll(async () => {
  await applySchemaAndSeed(env.DB);
});

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

describe('masters — capability gate (decisions.md D22)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // The §2.3 promise is structural: only super_admin carries the
  // five `*.write` master caps. One representative role per tier
  // (write-tier doer, read-only geo-admin) covers the gate.
  const denied: Array<['POST' | 'PATCH', string, string]> = [
    ['POST', '/api/villages', 'vc-anandpur'],
    ['POST', '/api/villages', 'cluster-bid01'],
    ['POST', '/api/villages', 'district-bid'],
    ['POST', '/api/schools', 'vc-anandpur'],
    ['POST', '/api/events', 'cluster-bid01'],
    ['POST', '/api/qualifications', 'state-ka'],
    ['POST', '/api/training-manuals', 'vc-anandpur'],
    ['POST', '/api/training-manuals', 'district-bid'],
    ['POST', '/api/users', 'af-bid01'],
  ];

  for (const [method, path, userId] of denied) {
    it(`${method} ${path} is 403 for ${userId}`, async () => {
      const token = await loginAs(userId);
      const res = await cookieFetch(path, token, {
        method,
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });
  }

  // The five admin list endpoints follow the same gate.
  const adminLists: Array<[string, string]> = [
    ['/api/villages/admin', 'vc-anandpur'],
    ['/api/schools/admin', 'cluster-bid01'],
    ['/api/events/admin', 'state-ka'],
    ['/api/qualifications', 'district-bid'],
    ['/api/users', 'af-bid01'],
  ];
  for (const [path, userId] of adminLists) {
    it(`GET ${path} is 403 for ${userId}`, async () => {
      const token = await loginAs(userId);
      const res = await cookieFetch(path, token);
      expect(res.status).toBe(403);
    });
  }
});

describe('villages master', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('super admin creates a village and admin list reflects it', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/villages', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Village', code: 'tv-001', cluster_id: 1 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { village: { id: number; name: string } };
    expect(body.village.name).toBe('Test Village');

    const listRes = await cookieFetch('/api/villages/admin', token);
    const list = (await listRes.json()) as { villages: Array<{ name: string }> };
    expect(list.villages.some((v) => v.name === 'Test Village')).toBe(true);
  });

  it('rejects duplicate code with 409', async () => {
    const token = await loginAs('super');
    const first = await cookieFetch('/api/villages', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'A', code: 'dup-001', cluster_id: 1 }),
    });
    expect(first.status).toBe(201);
    const second = await cookieFetch('/api/villages', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'B', code: 'dup-001', cluster_id: 1 }),
    });
    expect(second.status).toBe(409);
  });

  it('rejects unknown cluster_id with 400', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/villages', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'Orphan', code: 'orph-1', cluster_id: 9999 }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH renames and the admin list picks up the new name', async () => {
    const token = await loginAs('super');
    const create = await cookieFetch('/api/villages', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'Old', code: 'rn-001', cluster_id: 1 }),
    });
    const id = ((await create.json()) as { village: { id: number } }).village.id;
    const patch = await cookieFetch(`/api/villages/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });
    expect(patch.status).toBe(200);
    const listRes = await cookieFetch('/api/villages/admin', token);
    const list = (await listRes.json()) as { villages: Array<{ id: number; name: string }> };
    expect(list.villages.find((v) => v.id === id)?.name).toBe('New');
  });
});

describe('schools master', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('admin list returns all schools across all villages', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/schools/admin', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schools: Array<{ village_name: string }> };
    expect(body.schools.length).toBeGreaterThan(0);
    expect(body.schools[0]).toHaveProperty('village_name');
  });

  it('POST creates a school under an existing village', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/schools', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'New School', village_id: 1 }),
    });
    expect(res.status).toBe(201);
  });

  it('POST rejects unknown village_id', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/schools', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'Orphan', village_id: 9999 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('events master + kind immutability (closes H5)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('admin list reports kind_locked=0 for an event with no references', async () => {
    const token = await loginAs('super');
    // Create a fresh event so reference_count starts at 0.
    const create = await cookieFetch('/api/events', token, {
      method: 'POST',
      body: JSON.stringify({ kind: 'activity', name: 'Test Activity' }),
    });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { event: { id: number } }).event.id;
    const listRes = await cookieFetch('/api/events/admin', token);
    const list = (await listRes.json()) as {
      events: Array<{ id: number; kind_locked: 0 | 1; reference_count: number }>;
    };
    const row = list.events.find((e) => e.id === id);
    expect(row?.kind_locked).toBe(0);
    expect(row?.reference_count).toBe(0);
  });

  it('PATCH allows kind change while no row references the event', async () => {
    const token = await loginAs('super');
    const create = await cookieFetch('/api/events', token, {
      method: 'POST',
      body: JSON.stringify({ kind: 'activity', name: 'Mutable' }),
    });
    const id = ((await create.json()) as { event: { id: number } }).event.id;
    const patch = await cookieFetch(`/api/events/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'event' }),
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { event: { kind: string } }).event.kind).toBe('event');
  });

  it('PATCH freezes kind once an attendance session references the event (H5)', async () => {
    const token = await loginAs('super');
    // Event 3 in the seed is "Board Games" — an attendance session
    // can be created against it from a village in scope. The seed
    // has VC-anandpur (village 1) but we need an admin with write
    // access to attendance for village 1 — vc-anandpur fits.
    const vcToken = await loginAs('vc-anandpur');
    const day = (() => {
      const IST = (5 * 60 + 30) * 60 * 1000;
      return new Date(Date.now() + IST).toISOString().slice(0, 10);
    })();
    const att = await cookieFetch('/api/attendance', vcToken, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1,
        event_id: 3,
        date: day,
        start_time: '10:00',
        end_time: '11:00',
        marks: [{ student_id: 1, present: true }],
      }),
    });
    expect(att.status).toBe(200);

    const patch = await cookieFetch('/api/events/3', token, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'event' }),
    });
    expect(patch.status).toBe(409);
    const body = (await patch.json()) as { error: { code: string; message?: string } };
    expect(body.error.code).toBe('conflict');
    expect(body.error.message).toMatch(/frozen/);

    // Admin list should now mark this event kind_locked.
    const listRes = await cookieFetch('/api/events/admin', token);
    const list = (await listRes.json()) as {
      events: Array<{ id: number; kind_locked: 0 | 1 }>;
    };
    expect(list.events.find((e) => e.id === 3)?.kind_locked).toBe(1);
  });

  it('PATCH allows name + description changes even when kind is locked', async () => {
    const token = await loginAs('super');
    const vcToken = await loginAs('vc-anandpur');
    const day = (() => {
      const IST = (5 * 60 + 30) * 60 * 1000;
      return new Date(Date.now() + IST).toISOString().slice(0, 10);
    })();
    const att = await cookieFetch('/api/attendance', vcToken, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1,
        event_id: 3,
        date: day,
        start_time: '10:00',
        end_time: '11:00',
        marks: [{ student_id: 1, present: true }],
      }),
    });
    expect(att.status).toBe(200);

    const patch = await cookieFetch('/api/events/3', token, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed Activity', description: 'updated' }),
    });
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as { event: { name: string; description: string | null } };
    expect(body.event.name).toBe('Renamed Activity');
    expect(body.event.description).toBe('updated');
  });
});

describe('qualifications master', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('list is empty after seed (no migration data); POST creates and PATCH renames', async () => {
    const token = await loginAs('super');
    const initial = await cookieFetch('/api/qualifications', token);
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as { qualifications: unknown[] };
    expect(initialBody.qualifications).toEqual([]);

    const create = await cookieFetch('/api/qualifications', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'B.A. Education', description: 'Teaching degree' }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { qualification: { id: number; name: string } };

    const dup = await cookieFetch('/api/qualifications', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'B.A. Education' }),
    });
    expect(dup.status).toBe(409);

    const patch = await cookieFetch(`/api/qualifications/${created.qualification.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'B.A. Ed' }),
    });
    expect(patch.status).toBe(200);
    expect(
      ((await patch.json()) as { qualification: { name: string } }).qualification.name,
    ).toBe('B.A. Ed');
  });
});

describe('training manuals master', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('list is readable by every authenticated role; create/patch are super-admin', async () => {
    const adminToken = await loginAs('super');
    const create = await cookieFetch('/api/training-manuals', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        category: 'Onboarding',
        name: 'New VC walkthrough',
        link: 'https://example.org/vc-walkthrough.pdf',
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      manual: { id: number; updated_at: number };
    };
    expect(created.manual.id).toBeGreaterThan(0);
    expect(created.manual.updated_at).toBeGreaterThan(0);

    // A read-only role can list — `training_manual.read` is in the
    // shared READ_ONLY cap set.
    const vcToken = await loginAs('vc-anandpur');
    const list = await cookieFetch('/api/training-manuals', vcToken);
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      manuals: Array<{ name: string; category: string }>;
    };
    expect(body.manuals.some((m) => m.name === 'New VC walkthrough')).toBe(true);

    // …but cannot patch.
    const patchAsVc = await cookieFetch(
      `/api/training-manuals/${created.manual.id}`,
      vcToken,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Changed' }),
      },
    );
    expect(patchAsVc.status).toBe(403);
  });

  it('rejects duplicate (category, name) pair with 409 but allows same name in another category', async () => {
    const token = await loginAs('super');
    const first = await cookieFetch('/api/training-manuals', token, {
      method: 'POST',
      body: JSON.stringify({
        category: 'Onboarding',
        name: 'Field guide',
        link: 'https://example.org/a',
      }),
    });
    expect(first.status).toBe(201);

    const dup = await cookieFetch('/api/training-manuals', token, {
      method: 'POST',
      body: JSON.stringify({
        category: 'Onboarding',
        name: 'Field guide',
        link: 'https://example.org/b',
      }),
    });
    expect(dup.status).toBe(409);

    const otherCategory = await cookieFetch('/api/training-manuals', token, {
      method: 'POST',
      body: JSON.stringify({
        category: 'Attendance',
        name: 'Field guide',
        link: 'https://example.org/c',
      }),
    });
    expect(otherCategory.status).toBe(201);
  });

  it('rejects non-http(s) links with 400', async () => {
    const token = await loginAs('super');
    const bad = await cookieFetch('/api/training-manuals', token, {
      method: 'POST',
      body: JSON.stringify({
        category: 'Onboarding',
        name: 'Sketchy',
        link: 'javascript:alert(1)',
      }),
    });
    expect(bad.status).toBe(400);

    const relative = await cookieFetch('/api/training-manuals', token, {
      method: 'POST',
      body: JSON.stringify({
        category: 'Onboarding',
        name: 'Relative',
        link: '/internal/path',
      }),
    });
    expect(relative.status).toBe(400);
  });

  it('PATCH bumps updated_at', async () => {
    const token = await loginAs('super');
    const create = await cookieFetch('/api/training-manuals', token, {
      method: 'POST',
      body: JSON.stringify({
        category: 'Onboarding',
        name: 'Bump test',
        link: 'https://example.org/x',
      }),
    });
    const { manual: created } = (await create.json()) as {
      manual: { id: number; updated_at: number };
    };

    // Wait for the second-resolution clock to tick before the PATCH so
    // the bump is observable. nowEpochSeconds() truncates to whole
    // seconds, so a sub-second PATCH would land on the same value.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const patch = await cookieFetch(`/api/training-manuals/${created.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Bump test (revised)' }),
    });
    expect(patch.status).toBe(200);
    const { manual: patched } = (await patch.json()) as {
      manual: { name: string; updated_at: number };
    };
    expect(patched.name).toBe('Bump test (revised)');
    expect(patched.updated_at).toBeGreaterThan(created.updated_at);
  });
});

describe('users master', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('admin list includes seeded users with scope_name resolved', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/users', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: Array<{ user_id: string; role: string; scope_name: string | null }>;
    };
    const vc = body.users.find((u) => u.user_id === 'vc-anandpur');
    expect(vc?.role).toBe('vc');
    expect(vc?.scope_name).toBe('Anandpur');
    const sa = body.users.find((u) => u.user_id === 'super');
    expect(sa?.scope_name).toBeNull();
  });

  it('POST creates a VC; the new user can log in with the lab default password', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/users', token, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'vc-test-001',
        full_name: 'Test VC',
        role: 'vc',
        scope_id: 1, // Anandpur
      }),
    });
    expect(res.status).toBe(201);
    // No password in the body; server defaults to 'password' (D24).
    // loginAs() uses 'password' as the default — round-trips.
    const newToken = await loginAs('vc-test-001');
    expect(typeof newToken).toBe('string');
    expect(newToken.length).toBeGreaterThan(0);
  });

  it('rejects duplicate user_id with 409', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/users', token, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'super', // already exists in the seed
        full_name: 'Clone',
        role: 'super_admin',
      }),
    });
    expect(res.status).toBe(409);
  });

  it('rejects an unknown scope_id with 400', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/users', token, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'vc-orphan',
        full_name: 'Orphan',
        role: 'vc',
        scope_id: 9999,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('global-scope role rejects scope_id; non-global role requires it', async () => {
    const token = await loginAs('super');
    const withScope = await cookieFetch('/api/users', token, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'super-bogus',
        full_name: 'X',
        role: 'super_admin',
        scope_id: 1,
      }),
    });
    expect(withScope.status).toBe(400);

    const missingScope = await cookieFetch('/api/users', token, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'vc-bogus',
        full_name: 'X',
        role: 'vc',
        // no scope_id
      }),
    });
    expect(missingScope.status).toBe(400);
  });

  it('PATCH role change requires a fresh scope_id and stores the derived scope_level', async () => {
    const token = await loginAs('super');
    const create = await cookieFetch('/api/users', token, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'mover-1',
        full_name: 'Mover',
        role: 'vc',
        scope_id: 1,
      }),
    });
    const id = ((await create.json()) as { user: { id: number } }).user.id;
    const promote = await cookieFetch(`/api/users/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'cluster_admin', scope_id: 1 }),
    });
    expect(promote.status).toBe(200);
    const body = (await promote.json()) as {
      user: { role: string; scope_level: string };
    };
    expect(body.user.role).toBe('cluster_admin');
    expect(body.user.scope_level).toBe('cluster');
  });
});
