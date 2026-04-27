// Outbox queue integration (L4.0b — decisions.md D29, D32).
//
// fake-indexeddb is loaded in test/setup.ts so lib/idb.ts sees a
// real-shaped IDBFactory in jsdom. Each test wipes the DB so state
// doesn't leak across cases.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OUTBOX_HARD_CAP,
  OutboxFullError,
  counts,
  discard,
  enqueue,
  gcDone,
  listAll,
  markDeadLetter,
  markDone,
  markFailed,
  markInFlight,
  pickNextDue,
  retry,
  OUTBOX_CHANGED_EVENT,
} from '../src/lib/outbox';
import { deleteDatabase } from '../src/lib/idb';

beforeEach(async () => {
  await deleteDatabase();
});

afterEach(async () => {
  await deleteDatabase();
});

describe('enqueue', () => {
  it('persists a row in `pending` with a generated ULID', async () => {
    const row = await enqueue({
      method: 'POST',
      path: '/api/attendance/submit',
      body: { village_id: 1 },
      schema_version: 1,
    });
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.idempotency_key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(row.path).toBe('/api/attendance/submit');
    expect(row.build_id).toBeTruthy();
  });

  it('emits OUTBOX_CHANGED_EVENT after every mutation', async () => {
    const handler = vi.fn();
    window.addEventListener(OUTBOX_CHANGED_EVENT, handler);
    await enqueue({
      method: 'POST',
      path: '/api/x',
      body: null,
      schema_version: 1,
    });
    window.removeEventListener(OUTBOX_CHANGED_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('refuses past the hard cap', async () => {
    // Fast-fill the outbox by dropping individually-awaited writes.
    for (let i = 0; i < OUTBOX_HARD_CAP; i++) {
      await enqueue({
        method: 'POST',
        path: '/api/x',
        body: { i },
        schema_version: 1,
      });
    }
    await expect(
      enqueue({
        method: 'POST',
        path: '/api/x',
        body: { i: OUTBOX_HARD_CAP },
        schema_version: 1,
      }),
    ).rejects.toBeInstanceOf(OutboxFullError);
  }, 30_000);
});

describe('pickNextDue', () => {
  it('returns the oldest pending row when nothing is failed-with-retry', async () => {
    const a = await enqueue({
      method: 'POST',
      path: '/a',
      body: null,
      schema_version: 1,
    });
    await enqueue({
      method: 'POST',
      path: '/b',
      body: null,
      schema_version: 1,
    });
    const next = await pickNextDue();
    expect(next?.idempotency_key).toBe(a.idempotency_key);
  });

  it('skips rows whose next_attempt_at is still in the future', async () => {
    const a = await enqueue({
      method: 'POST',
      path: '/a',
      body: null,
      schema_version: 1,
    });
    // Mark failed — bumps next_attempt_at by ~1s.
    await markFailed(a.idempotency_key, 'transient');
    const now = Date.now();
    expect(await pickNextDue(now)).toBeNull();
    // Advance the clock past the backoff window.
    expect(await pickNextDue(now + 60_000)).not.toBeNull();
  });

  it('ignores rows that are in_flight, dead_letter, or done', async () => {
    const inFlight = await enqueue({
      method: 'POST',
      path: '/a',
      body: null,
      schema_version: 1,
    });
    await markInFlight(inFlight.idempotency_key);
    const dead = await enqueue({
      method: 'POST',
      path: '/b',
      body: null,
      schema_version: 1,
    });
    await markDeadLetter(dead.idempotency_key, 'bad');
    const done = await enqueue({
      method: 'POST',
      path: '/c',
      body: null,
      schema_version: 1,
    });
    await markDone(done.idempotency_key);
    expect(await pickNextDue()).toBeNull();
  });
});

describe('markFailed', () => {
  it('flips to failed and bumps next_attempt_at on a retryable failure', async () => {
    const row = await enqueue({
      method: 'POST',
      path: '/a',
      body: null,
      schema_version: 1,
    });
    const before = Date.now();
    await markFailed(row.idempotency_key, 'http 500');
    const all = await listAll();
    const updated = all.find((r) => r.idempotency_key === row.idempotency_key)!;
    expect(updated.status).toBe('failed');
    expect(updated.attempts).toBe(1);
    expect(updated.last_error).toContain('http 500');
    expect(updated.next_attempt_at).toBeGreaterThanOrEqual(before);
  });

  it('flips to dead_letter once attempts exhausts the retry budget', async () => {
    const row = await enqueue({
      method: 'POST',
      path: '/a',
      body: null,
      schema_version: 1,
    });
    // Walk the schedule up to the cap.
    for (let i = 0; i < 4; i++) {
      await markFailed(row.idempotency_key, `attempt ${i}`);
    }
    let all = await listAll();
    expect(all[0]!.status).toBe('failed');
    // Fifth failure dead-letters.
    await markFailed(row.idempotency_key, 'final');
    all = await listAll();
    expect(all[0]!.status).toBe('dead_letter');
    expect(all[0]!.attempts).toBe(5);
  });
});

describe('retry / discard', () => {
  it('retry resets a dead-lettered row to pending with attempts=0', async () => {
    const row = await enqueue({
      method: 'POST',
      path: '/a',
      body: null,
      schema_version: 1,
    });
    await markDeadLetter(row.idempotency_key, 'bad request');
    await retry(row.idempotency_key);
    const next = await pickNextDue();
    expect(next?.idempotency_key).toBe(row.idempotency_key);
    expect(next?.attempts).toBe(0);
    expect(next?.status).toBe('pending');
  });

  it('discard removes the row entirely', async () => {
    const row = await enqueue({
      method: 'POST',
      path: '/a',
      body: null,
      schema_version: 1,
    });
    await discard(row.idempotency_key);
    expect(await listAll()).toHaveLength(0);
  });
});

describe('counts + gcDone', () => {
  it('counts each status correctly', async () => {
    const a = await enqueue({
      method: 'POST',
      path: '/a',
      body: null,
      schema_version: 1,
    });
    const b = await enqueue({
      method: 'POST',
      path: '/b',
      body: null,
      schema_version: 1,
    });
    const c = await enqueue({
      method: 'POST',
      path: '/c',
      body: null,
      schema_version: 1,
    });
    await markInFlight(b.idempotency_key);
    await markFailed(c.idempotency_key, 'oops');

    const result = await counts();
    expect(result.pending).toBe(1);
    expect(result.in_flight).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.dead_letter).toBe(0);
    expect(result.total).toBe(3);
    // Reference `a` so the variable isn't unused.
    expect(a.idempotency_key).toBeTruthy();
  });

  it('gcDone removes done rows older than the retention window', async () => {
    const row = await enqueue({
      method: 'POST',
      path: '/a',
      body: null,
      schema_version: 1,
    });
    await markDone(row.idempotency_key);
    // 0ms retention — anything done is older than the cutoff.
    const removed = await gcDone(0);
    expect(removed).toBe(1);
    expect(await listAll()).toHaveLength(0);
  });
});
