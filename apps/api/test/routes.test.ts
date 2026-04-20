import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySchemaAndSeed, loginAs, resetDb } from './setup';

beforeAll(async () => {
  // Apply schema once; each `it` cleans and re-seeds so tests are
  // independent but the DDL is paid for once.
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

describe('auth', () => {
  it('rejects bad credentials with the canonical error shape', async () => {
    const res = await SELF.fetch('http://api.test/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: 'super', password: 'wrong' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'unauthenticated', message: 'invalid credentials' },
    });
  });

  it('/auth/me after login returns the session user', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/auth/me', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { user_id: string; role: string } };
    expect(body.user.user_id).toBe('vc-anandpur');
    expect(body.user.role).toBe('vc');
  });
});

describe('scope enforcement', () => {
  it('a VC accessing a sibling village returns 403', async () => {
    const token = await loginAs('vc-anandpur');
    // Anandpur is village 1; Belur is village 2.
    const res = await cookieFetch('/api/children?village_id=2', token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'forbidden' } });
  });

  it('a VC can list children in their own village', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children?village_id=1', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { children: unknown[] };
    expect(body.children.length).toBeGreaterThan(0);
  });

  it('an AF can reach any village in their cluster', async () => {
    const token = await loginAs('af-bid01');
    for (const villageId of [1, 2, 3]) {
      const res = await cookieFetch(`/api/children?village_id=${villageId}`, token);
      expect(res.status).toBe(200);
    }
  });
});

describe('attendance', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('rejects dates other than today with the canonical bad_request', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1,
        date: '2020-01-01',
        marks: [{ student_id: 1, present: true }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message?: string } };
    expect(body.error.code).toBe('bad_request');
    expect(body.error.message).toMatch(/today/i);
  });

  it('rejects a malformed date', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1,
        date: 'not-a-date',
        marks: [{ student_id: 1, present: true }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message?: string } };
    expect(body.error.message).toMatch(/yyyy-mm-dd/i);
  });

  it('happy path: VC submits today and dashboard reflects it', async () => {
    const token = await loginAs('vc-anandpur');
    const list = await cookieFetch('/api/children?village_id=1', token);
    const { children } = (await list.json()) as {
      children: Array<{ id: number }>;
    };
    const marks = children.map((c, i) => ({
      student_id: c.id,
      present: i % 2 === 0,
    }));
    const presentCount = marks.filter((m) => m.present).length;

    const post = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify({ village_id: 1, marks }),
    });
    expect(post.status).toBe(200);

    const dash = await cookieFetch('/api/dashboard/attendance', token);
    expect(dash.status).toBe(200);
    const body = (await dash.json()) as {
      date: string;
      villages: Array<{ village_id: number; present: number; total: number }>;
    };
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const anandpur = body.villages.find((v) => v.village_id === 1);
    expect(anandpur?.present).toBe(presentCount);
    expect(anandpur?.total).toBe(marks.length);
  });
});

describe('children write — role allow-list', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('super_admin can add a child to any village', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1,
        school_id: 1,
        first_name: 'Test',
        last_name: 'Child',
        gender: 'o',
        dob: '2018-06-15',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects a dob that is not YYYY-MM-DD', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1,
        school_id: 1,
        first_name: 'Test',
        last_name: 'Child',
        gender: 'm',
        dob: 1234567890,
      }),
    });
    expect(res.status).toBe(400);
  });
});
