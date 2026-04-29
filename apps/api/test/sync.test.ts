// L4.1a — manifest endpoint + idempotency-key dedupe.
//
// Two test areas in one file because they share the seeded DB and
// both belong to the L4.1a slice (read-cache hydration + write
// idempotent replay).

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

describe('GET /api/sync/manifest — replace-snapshot scoped to user', () => {
  it('returns the VC scope: their one village + active students only', async () => {
    const token = await loginAs('vc-anandpur'); // village_id 1
    const res = await cookieFetch('/api/sync/manifest', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generated_at: number;
      scope: { level: string; id: number | null; village_ids: number[] };
      villages: Array<{ id: number; name: string }>;
      students: Array<{ id: number; village_id: number; first_name: string }>;
    };

    expect(body.scope.level).toBe('village');
    expect(body.scope.id).toBe(1);
    expect(body.scope.village_ids).toEqual([1]);
    expect(body.villages).toHaveLength(1);
    expect(body.villages[0]!.id).toBe(1);

    // Every returned student belongs to a village in scope. Graduated
    // students are excluded, so a count match against `student WHERE
    // village_id = 1 AND graduated_at IS NULL` is the right oracle.
    const directRows = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM student
          WHERE village_id = 1 AND graduated_at IS NULL`,
      )
      .first<{ n: number }>();
    expect(body.students).toHaveLength(directRows!.n);
    for (const s of body.students) expect(s.village_id).toBe(1);

    // generated_at is roughly now (seconds, within ±60s of test time).
    const drift = Math.abs(Date.now() / 1000 - body.generated_at);
    expect(drift).toBeLessThan(60);
  });

  it('returns the cluster scope for a cluster-admin: every village in their cluster', async () => {
    const token = await loginAs('cluster-bid01'); // cluster_id 1
    const res = await cookieFetch('/api/sync/manifest', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scope: { level: string; village_ids: number[] };
      villages: Array<{ id: number }>;
    };
    expect(body.scope.level).toBe('cluster');
    // Cluster 1 has at least villages 1 and 2 in the seed; cluster
    // admins see every village in their cluster.
    expect(body.villages.length).toBeGreaterThan(1);
    expect(body.scope.village_ids.length).toBe(body.villages.length);
  });

  it('rejects an unauthenticated caller with 401', async () => {
    const res = await SELF.fetch('http://api.test/api/sync/manifest');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/achievements — Idempotency-Key dedupe (§5.1)', () => {
  // Helpers for a complete payload. SoM is the cheapest case to
  // exercise — already idempotent via the partial unique index, so
  // a replay returning the same body proves the key path works.
  // gold/silver are the case that actually needs the key (each call
  // would otherwise create a fresh row), tested separately below.
  function somPayload(studentId: number) {
    return {
      student_id: studentId,
      description: 'first place in the district science fair',
      date: new Date().toISOString().slice(0, 10),
      type: 'som' as const,
    };
  }

  function goldPayload(studentId: number) {
    return {
      student_id: studentId,
      description: 'state-level chess tournament',
      date: new Date().toISOString().slice(0, 10),
      type: 'gold' as const,
      gold_count: 1,
    };
  }

  it('replays the prior 201 + body when the same key arrives twice (gold)', async () => {
    const token = await loginAs('vc-anandpur'); // village 1, can write
    // Pick any active student in village 1 — fixture has at least
    // one (student.id=1) created by the seed.
    const student = await env.DB
      .prepare(
        `SELECT id FROM student WHERE village_id = 1 AND graduated_at IS NULL LIMIT 1`,
      )
      .first<{ id: number }>();
    const payload = goldPayload(student!.id);

    const key = '01HXX0000000000000000000A1';
    const first = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      achievement: { id: number; type: string };
    };

    // Second call with the same key should return the *same* response
    // (id, status), not a fresh row. Without the dedupe, gold/silver
    // would create a duplicate.
    const second = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as {
      achievement: { id: number };
    };
    expect(secondBody.achievement.id).toBe(firstBody.achievement.id);

    // Side-channel oracle: only one row exists for this student.
    const count = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM achievement
          WHERE student_id = ? AND type = 'gold'`,
      )
      .bind(student!.id)
      .first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it('without an Idempotency-Key header, two POSTs create two rows (gold)', async () => {
    const token = await loginAs('vc-anandpur');
    const student = await env.DB
      .prepare(
        `SELECT id FROM student WHERE village_id = 1 AND graduated_at IS NULL LIMIT 1`,
      )
      .first<{ id: number }>();

    await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify(goldPayload(student!.id)),
    });
    await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify(goldPayload(student!.id)),
    });

    const count = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM achievement
          WHERE student_id = ? AND type = 'gold'`,
      )
      .bind(student!.id)
      .first<{ n: number }>();
    // No dedupe → two rows. This is the contract for direct API
    // callers; the outbox always supplies a key, so production
    // doesn't hit this branch.
    expect(count!.n).toBe(2);
  });

  it('SoM upsert path replays the same key as a 200 (the original was 200)', async () => {
    const token = await loginAs('vc-anandpur');
    // Pick the student who already holds the current-month SoM in
    // village 1 (seeded). The upsert branch is the one that needs
    // exercising; that student's POST returns 200, not 201.
    const sommer = await env.DB
      .prepare(
        `SELECT a.student_id AS id FROM achievement a
          JOIN student s ON s.id = a.student_id
          WHERE s.village_id = 1 AND a.type = 'som'
            AND substr(a.date, 1, 7) = substr(date('now'), 1, 7)
          LIMIT 1`,
      )
      .first<{ id: number }>();
    expect(sommer).not.toBeNull();

    const key = '01HXX0000000000000000000B2';
    const first = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(somPayload(sommer!.id)),
    });
    expect(first.status).toBe(200);

    const second = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(somPayload(sommer!.id)),
    });
    expect(second.status).toBe(200);
  });

  it('keys are user-scoped — same key from a different user runs as fresh (gold)', async () => {
    // Two VCs, two villages. Issuing the same key from each is two
    // separate intents and must not collapse into one.
    const tokenA = await loginAs('vc-anandpur'); // village 1
    const tokenB = await loginAs('vc-belur');    // village 2

    const studentA = await env.DB
      .prepare(`SELECT id FROM student WHERE village_id = 1 AND graduated_at IS NULL LIMIT 1`)
      .first<{ id: number }>();
    const studentB = await env.DB
      .prepare(`SELECT id FROM student WHERE village_id = 2 AND graduated_at IS NULL LIMIT 1`)
      .first<{ id: number }>();

    const key = '01HXX0000000000000000000C3';
    const a = await cookieFetch('/api/achievements', tokenA, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(goldPayload(studentA!.id)),
    });
    const b = await cookieFetch('/api/achievements', tokenB, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(goldPayload(studentB!.id)),
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const countA = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM achievement WHERE student_id = ? AND type = 'gold'`)
      .bind(studentA!.id)
      .first<{ n: number }>();
    const countB = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM achievement WHERE student_id = ? AND type = 'gold'`)
      .bind(studentB!.id)
      .first<{ n: number }>();
    expect(countA!.n).toBe(1);
    expect(countB!.n).toBe(1);
  });
});
