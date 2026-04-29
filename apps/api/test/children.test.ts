// L4.1b — POST /api/children Idempotency-Key dedupe (D35).
//
// Per D35, child creation is `offline-eligible` under the
// visibility-after-sync rule. Server-side this means standard
// idempotency-key dedupe so an outbox replay returns the prior
// 201 instead of creating a duplicate row.

import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySchemaAndSeed, loginAs, resetDb } from './setup';

beforeAll(async () => {
  await applySchemaAndSeed(env.DB);
});

beforeEach(resetDb);

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

function newChildBody(suffix: string) {
  return {
    village_id: 1,
    school_id: 1,
    first_name: `IdempTest${suffix}`,
    last_name: 'Patil',
    gender: 'f' as const,
    dob: '2018-05-12',
    // §3.2.2 — at least one parent name is required, and the
    // smartphone flag has to be set (true here so the §3.2.2 alt-
    // contact rule doesn't fire).
    father_name: 'Ramesh Patil',
    father_phone: '9988776655',
    father_has_smartphone: 1 as const,
  };
}

describe('POST /api/children — Idempotency-Key dedupe (D35)', () => {
  it('replays the prior 201 + body on a same-key retry', async () => {
    const token = await loginAs('vc-anandpur');
    const key = '01HYY0000000000000000000A1';
    const payload = newChildBody('A1');

    const first = await cookieFetch('/api/children', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: number };

    const second = await cookieFetch('/api/children', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { id: number };
    expect(secondBody.id).toBe(firstBody.id);

    // Side-channel oracle: only one new row exists for this name.
    const count = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM student
          WHERE first_name = ? AND last_name = 'Patil' AND village_id = 1`,
      )
      .bind(payload.first_name)
      .first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it('without the header, two POSTs create two rows (regression of the dedupe wrapper itself)', async () => {
    const token = await loginAs('vc-anandpur');
    const payload = newChildBody('Bare');

    await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const count = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM student
          WHERE first_name = ? AND last_name = 'Patil' AND village_id = 1`,
      )
      .bind(payload.first_name)
      .first<{ n: number }>();
    expect(count!.n).toBe(2);
  });

  it('keys are user-scoped — the same key from a different user runs as a fresh request', async () => {
    const tokenA = await loginAs('vc-anandpur');
    const tokenB = await loginAs('cluster-bid01'); // cluster admin can write children too

    const key = '01HYY0000000000000000000C3';
    const a = await cookieFetch('/api/children', tokenA, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(newChildBody('A')),
    });
    const b = await cookieFetch('/api/children', tokenB, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(newChildBody('B')),
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const both = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM student
          WHERE first_name LIKE 'IdempTest%' AND last_name = 'Patil' AND village_id = 1`,
      )
      .first<{ n: number }>();
    expect(both!.n).toBe(2);
  });

  it('validation errors short-circuit before the dedupe wrapper (so they are NOT cached)', async () => {
    // Pre-validate path returns 400 without touching idempotency_key
    // store; a subsequent valid request with the same key must run
    // fresh, not replay the bad_request.
    const token = await loginAs('vc-anandpur');
    const key = '01HYY0000000000000000000VV';

    const bad = await cookieFetch('/api/children', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ ...newChildBody('Validate'), gender: 'x' }),
    });
    expect(bad.status).toBe(400);

    const good = await cookieFetch('/api/children', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(newChildBody('Validate')),
    });
    expect(good.status).toBe(201);
  });
});
