// Read-cache helpers (L4.1a — D32 replace-snapshot).
//
// Backed by the IDB `cache_villages` and `cache_students` stores
// (idb.ts v2 migration). The manifest pull (lib/manifest.ts) wipes
// and reseeds these stores; everything else is read-only.
//
// Per offline-scope.md "Scope-bound caching", the data here is the
// authenticated user's authority — kilobytes for a VC. There is no
// PII protection beyond what the user sees in-app, so these stores
// don't need the encryption-at-rest treatment §6.8 reserves for the
// outbox.

import type {
  ManifestEvent,
  ManifestStudent,
  ManifestVillage,
} from '@navsahyog/shared';
import {
  dbClear,
  dbGetAll,
  dbGetAllByIndex,
  dbGet,
  dbPut,
  tx,
} from './idb';

// `meta` row keys. Values are JSON-serialisable.
type MetaRow = { key: string; value: unknown };

const META_LAST_SYNCED = 'last_synced_at';

// Replace-snapshot — wipe every read-cache store in one transaction,
// then repopulate from the manifest payload. A failure mid-write
// leaves the cache empty rather than half-populated; the next pull
// tries again. Empty cache is a valid state (offline reads degrade
// to "sync to see data", same as a brand-new install).
//
// `events` is optional so an L4.1a/b server (no events in response)
// is handled gracefully — the existing cache_events stays as-is in
// that case. L4.1c onwards always populates it.
export async function replaceSnapshot(args: {
  villages: ManifestVillage[];
  students: ManifestStudent[];
  events?: ManifestEvent[];
  generatedAt: number;
}): Promise<void> {
  const stores: Array<'cache_villages' | 'cache_students' | 'cache_events'> = [
    'cache_villages',
    'cache_students',
  ];
  if (args.events !== undefined) stores.push('cache_events');
  await dbClear(stores);
  // Single transaction across every cache store keeps the seed
  // atomic from the perspective of any concurrent reader (a render
  // that races a sync pull never sees a half-populated cache).
  await tx(stores, 'readwrite', async (t) => {
    const v = t.objectStore('cache_villages');
    for (const row of args.villages) v.put(row);
    const s = t.objectStore('cache_students');
    for (const row of args.students) s.put(row);
    if (args.events !== undefined) {
      const e = t.objectStore('cache_events');
      for (const row of args.events) e.put(row);
    }
  });
  await dbPut('meta', { key: META_LAST_SYNCED, value: args.generatedAt });
}

// Wipes the read-cache stores (and `last_synced_at`). Logout calls
// this — §6.8 requires the device to forget user-scoped data on
// session end.
export async function wipeCache(): Promise<void> {
  await dbClear([
    'cache_villages',
    'cache_students',
    'cache_events',
    'meta',
  ]);
}

export async function listCachedVillages(): Promise<ManifestVillage[]> {
  const rows = await dbGetAll<ManifestVillage>('cache_villages');
  // Stable order for the picker — matches the server's ORDER BY name.
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export async function listCachedStudents(
  villageId: number,
): Promise<ManifestStudent[]> {
  const rows = await dbGetAllByIndex<ManifestStudent>(
    'cache_students',
    'by_village_id',
    villageId,
  );
  rows.sort((a, b) => {
    const ln = a.last_name.localeCompare(b.last_name);
    return ln !== 0 ? ln : a.first_name.localeCompare(b.first_name);
  });
  return rows;
}

export async function lastSyncedAt(): Promise<number | null> {
  const row = await dbGet<MetaRow>('meta', META_LAST_SYNCED);
  if (!row) return null;
  return typeof row.value === 'number' ? row.value : null;
}

export async function listCachedEvents(): Promise<ManifestEvent[]> {
  const rows = await dbGetAll<ManifestEvent>('cache_events');
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
