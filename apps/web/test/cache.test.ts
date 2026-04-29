// Read-cache + manifest pull (L4.1a — D32 replace-snapshot).
//
// Exercises the cache module's replace + read paths against fake-
// indexeddb (test/setup.ts), and the manifest pull's fetch +
// reseed flow with a stubbed `fetch`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lastSyncedAt,
  listCachedStudents,
  listCachedVillages,
  replaceSnapshot,
  wipeCache,
} from '../src/lib/cache';
import { pullManifest } from '../src/lib/manifest';
import { _resetDb, deleteDatabase } from '../src/lib/idb';

beforeEach(async () => {
  await _resetDb();
  await deleteDatabase();
});

afterEach(async () => {
  await _resetDb();
  await deleteDatabase();
});

const sampleVillages = [
  { id: 1, name: 'Anandpur', code: 'AN', cluster_id: 1, cluster_name: 'Bid01' },
  { id: 2, name: 'Belur', code: 'BE', cluster_id: 1, cluster_name: 'Bid01' },
];

const sampleStudents = [
  { id: 10, village_id: 1, school_id: 1, first_name: 'Asha', last_name: 'Kale' },
  { id: 11, village_id: 1, school_id: 1, first_name: 'Bhavna', last_name: 'Naik' },
  { id: 20, village_id: 2, school_id: 2, first_name: 'Chetan', last_name: 'Shet' },
];

describe('cache module — replaceSnapshot + reads', () => {
  it('replaceSnapshot wipes prior contents and seeds the new payload', async () => {
    await replaceSnapshot({
      villages: sampleVillages,
      students: sampleStudents,
      generatedAt: 1000,
    });
    expect(await listCachedVillages()).toHaveLength(2);
    expect(await lastSyncedAt()).toBe(1000);

    // Second call with a smaller payload — old rows must be gone,
    // not merged. This is the D32 contract: cache reflects the
    // server, not a delta.
    await replaceSnapshot({
      villages: [sampleVillages[0]!],
      students: [sampleStudents[0]!],
      generatedAt: 2000,
    });
    expect(await listCachedVillages()).toHaveLength(1);
    expect(await listCachedStudents(1)).toHaveLength(1);
    expect(await listCachedStudents(2)).toHaveLength(0);
    expect(await lastSyncedAt()).toBe(2000);
  });

  it('listCachedStudents filters by village_id via the secondary index', async () => {
    await replaceSnapshot({
      villages: sampleVillages,
      students: sampleStudents,
      generatedAt: 0,
    });
    const v1 = await listCachedStudents(1);
    expect(v1.map((s) => s.id).sort()).toEqual([10, 11]);
    const v2 = await listCachedStudents(2);
    expect(v2.map((s) => s.id)).toEqual([20]);
    const v999 = await listCachedStudents(999);
    expect(v999).toEqual([]);
  });

  it('listCachedStudents sorts by last_name then first_name', async () => {
    await replaceSnapshot({
      villages: [sampleVillages[0]!],
      students: [
        { id: 1, village_id: 1, school_id: 1, first_name: 'B', last_name: 'Z' },
        { id: 2, village_id: 1, school_id: 1, first_name: 'A', last_name: 'A' },
        { id: 3, village_id: 1, school_id: 1, first_name: 'C', last_name: 'A' },
      ],
      generatedAt: 0,
    });
    const ordered = await listCachedStudents(1);
    expect(ordered.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('wipeCache clears every cache_* store and the meta sentinel', async () => {
    await replaceSnapshot({
      villages: sampleVillages,
      students: sampleStudents,
      generatedAt: 5_000,
    });
    expect(await listCachedVillages()).toHaveLength(2);
    expect(await lastSyncedAt()).toBe(5_000);
    await wipeCache();
    expect(await listCachedVillages()).toHaveLength(0);
    expect(await listCachedStudents(1)).toHaveLength(0);
    expect(await lastSyncedAt()).toBeNull();
  });
});

describe('manifest pull — fetch + reseed', () => {
  // The original `fetch` is restored after each test. The pull
  // module is single-flight; that's exercised by parallel calls
  // returning the same promise, which we observe via fetch call
  // count.
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetchOk(body: unknown): { calls: number } {
    const meta = { calls: 0 };
    globalThis.fetch = vi.fn(async () => {
      meta.calls++;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return meta;
  }

  it('seeds the cache stores from the manifest response', async () => {
    stubFetchOk({
      generated_at: 12_345,
      scope: { level: 'village', id: 1, village_ids: [1] },
      villages: sampleVillages,
      students: sampleStudents,
    });
    const body = await pullManifest();
    expect(body?.generated_at).toBe(12_345);
    expect(await listCachedVillages()).toHaveLength(2);
    expect(await listCachedStudents(1)).toHaveLength(2);
    expect(await lastSyncedAt()).toBe(12_345);
  });

  it('coalesces concurrent pulls into a single network call', async () => {
    const meta = stubFetchOk({
      generated_at: 0,
      scope: { level: 'village', id: 1, village_ids: [1] },
      villages: sampleVillages,
      students: sampleStudents,
    });
    const [a, b, c] = await Promise.all([
      pullManifest(),
      pullManifest(),
      pullManifest(),
    ]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(meta.calls).toBe(1);
  });

  it('returns null on a 5xx and leaves the prior cache untouched', async () => {
    // Pre-seed with a known cache.
    await replaceSnapshot({
      villages: [sampleVillages[0]!],
      students: [sampleStudents[0]!],
      generatedAt: 7_777,
    });
    globalThis.fetch = vi.fn(async () => {
      return new Response('error', { status: 500 });
    }) as unknown as typeof fetch;

    expect(await pullManifest()).toBeNull();
    // Cache untouched.
    expect(await listCachedVillages()).toHaveLength(1);
    expect(await lastSyncedAt()).toBe(7_777);
  });

  it('returns null on a network error and leaves the prior cache untouched', async () => {
    await replaceSnapshot({
      villages: [sampleVillages[0]!],
      students: [sampleStudents[0]!],
      generatedAt: 8_888,
    });
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await pullManifest()).toBeNull();
    expect(await listCachedVillages()).toHaveLength(1);
    expect(await lastSyncedAt()).toBe(8_888);
  });
});
