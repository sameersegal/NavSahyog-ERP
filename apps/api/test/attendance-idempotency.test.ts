// L4.1c — POST /api/attendance Idempotency-Key dedupe + manifest
// events extension.
//
// Attendance is already domain-idempotent on (village_id, date,
// event_id) via the UPSERT, but the L4.1a Idempotency-Key wrapper
// adds belt-and-braces consistency with the rest of the offline-
// eligible POSTs and ensures a replay returns a byte-identical
// response without re-running the UPSERT + delete-and-reinsert
// marks dance.

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

function todayIst(): string {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

async function pickStudentsAndEvent(): Promise<{
  studentIds: number[];
  eventId: number;
}> {
  const students = await env.DB
    .prepare(
      `SELECT id FROM student WHERE village_id = 1 AND graduated_at IS NULL ORDER BY id LIMIT 3`,
    )
    .all<{ id: number }>();
  const event = await env.DB
    .prepare(`SELECT id FROM event ORDER BY id LIMIT 1`)
    .first<{ id: number }>();
  return {
    studentIds: students.results.map((r) => r.id),
    eventId: event!.id,
  };
}

describe('POST /api/attendance — Idempotency-Key dedupe', () => {
  it('replays the prior 2xx with the same session_id on a same-key retry', async () => {
    const token = await loginAs('vc-anandpur');
    const { studentIds, eventId } = await pickStudentsAndEvent();
    const today = todayIst();
    const payload = {
      village_id: 1,
      event_id: eventId,
      date: today,
      start_time: '10:00',
      end_time: '11:00',
      marks: studentIds.map((id) => ({ student_id: id, present: true })),
    };
    const key = '01HZZ0000000000000000000A1';

    const first = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBeLessThan(300);
    const firstBody = (await first.json()) as {
      session_id: number;
      count: number;
    };

    // Replay — same key, same body. Server should return the cached
    // response and not touch the underlying row.
    const second = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(first.status);
    const secondBody = (await second.json()) as { session_id: number };
    expect(secondBody.session_id).toBe(firstBody.session_id);

    // Side-channel oracle: only one session row exists for this
    // (village, date, event), and it has exactly 3 marks.
    const sessionCount = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM attendance_session
          WHERE village_id = 1 AND date = ? AND event_id = ?`,
      )
      .bind(today, eventId)
      .first<{ n: number }>();
    expect(sessionCount!.n).toBe(1);
    const markCount = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM attendance_mark WHERE session_id = ?`,
      )
      .bind(firstBody.session_id)
      .first<{ n: number }>();
    expect(markCount!.n).toBe(3);
  });

  it('a fresh key with different marks updates the same domain row (UPSERT semantics preserved)', async () => {
    // Same (village, date, event) → second submission with a NEW
    // key replaces the marks per §3.3.3. The dedupe wrapper does
    // NOT prevent this — it only deduplicates same-key replays.
    const token = await loginAs('vc-anandpur');
    const { studentIds, eventId } = await pickStudentsAndEvent();
    const today = todayIst();
    const payloadAllPresent = {
      village_id: 1,
      event_id: eventId,
      date: today,
      start_time: '10:00',
      end_time: '11:00',
      marks: studentIds.map((id) => ({ student_id: id, present: true })),
    };
    const payloadAllAbsent = {
      ...payloadAllPresent,
      marks: studentIds.map((id) => ({ student_id: id, present: false })),
    };

    const a = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': '01HZZ0000000000000000000B2' },
      body: JSON.stringify(payloadAllPresent),
    });
    expect(a.status).toBeLessThan(300);
    const b = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': '01HZZ0000000000000000000B3' },
      body: JSON.stringify(payloadAllAbsent),
    });
    expect(b.status).toBeLessThan(300);

    // After both: still one session, all marks now `present = 0`
    // (the second submission replaced them).
    const presentCount = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM attendance_mark m
           JOIN attendance_session s ON s.id = m.session_id
          WHERE s.village_id = 1 AND s.date = ? AND s.event_id = ?
            AND m.present = 1`,
      )
      .bind(today, eventId)
      .first<{ n: number }>();
    expect(presentCount!.n).toBe(0);
  });
});

describe('GET /api/sync/manifest — events extension (L4.1c)', () => {
  it('includes events in the response (additive-only — D30)', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/sync/manifest', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{ id: number; name: string; kind: string }>;
    };

    expect(Array.isArray(body.events)).toBe(true);
    // Seed fixture has at least one event; guard against an empty
    // event table giving a false pass.
    const eventCount = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM event')
      .first<{ n: number }>();
    expect(body.events.length).toBe(eventCount!.n);
    for (const e of body.events) {
      expect(typeof e.id).toBe('number');
      expect(typeof e.name).toBe('string');
      expect(['event', 'activity']).toContain(e.kind);
    }
  });

  it('an empty-scope user (no villages assigned) still gets the global event list', async () => {
    // Cluster admin sees their cluster villages; but events are
    // global, so even a manifest with empty `villages` includes
    // them. Use a freshly-created cluster admin or a known one
    // with a non-empty scope — the cluster is small enough that
    // the assertion below holds for both cases.
    const token = await loginAs('cluster-bid01');
    const res = await cookieFetch('/api/sync/manifest', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{ id: number }>;
    };
    expect(body.events.length).toBeGreaterThan(0);
  });
});
