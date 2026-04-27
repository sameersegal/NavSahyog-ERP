// IndexedDB migration framework (L4.0b — decisions.md D29).
//
// Versioned, forward-only schema for the offline platform. Each
// release that needs a new store or index appends a migration step;
// IDB invokes them in order on `onupgradeneeded` so a client jumping
// from v1 to v3 still gets the v2 + v3 changes applied. There is no
// backwards migration — on a genuinely breaking shape change we
// drop-and-resync next online window (level-4.md "Working principles"
// rule on cache evolution).
//
// L4.0b ships only v1 (the `outbox` store). New stores (cache_*,
// media_blobs, audit) slot in as v2+ when L4.1 wires the live
// workflows. The framework is the load-bearing piece of this PR.

const DB_NAME = 'navsahyog';

// Bump this with every new migration. Migrations array length must
// equal LATEST_VERSION; the assertion at module load catches drift.
const LATEST_VERSION = 1;

type MigrationStep = (db: IDBDatabase, tx: IDBTransaction) => void;

// One step per version. `migrations[i]` runs when upgrading *to*
// version `i + 1` (so migrations[0] creates the v1 schema). The
// transaction is the upgrade transaction supplied by IDB; do not
// call `tx.commit()` — IDB commits on completion.
const migrations: readonly MigrationStep[] = [
  // v1 — outbox store. Primary key is the idempotency_key (ULID),
  // which sorts by creation time. Two indexes:
  //   * by_status         — drives outbox UI filtering (pending /
  //                         in_flight / failed / dead_letter / done).
  //   * by_next_attempt   — drives the drain runner's "what's due
  //                         to be attempted" pick.
  (db) => {
    const store = db.createObjectStore('outbox', {
      keyPath: 'idempotency_key',
    });
    store.createIndex('by_status', 'status', { unique: false });
    store.createIndex('by_next_attempt_at', 'next_attempt_at', {
      unique: false,
    });
  },
];

if (migrations.length !== LATEST_VERSION) {
  throw new Error(
    `idb migrations length ${migrations.length} != LATEST_VERSION ${LATEST_VERSION}`,
  );
}

// ---------------------------------------------------------------------------
// Open + handle caching
// ---------------------------------------------------------------------------
//
// One open IDB connection per page lifecycle. Subsequent calls
// re-use it. The factory is overridable for tests (jsdom uses
// fake-indexeddb and overrides the global; node tests can also pass
// an explicit factory).

let dbPromise: Promise<IDBDatabase> | null = null;

export function setIdbFactory(factory: IDBFactory): void {
  dbPromise = null; // force re-open on next access
  (globalThis as { __navsahyogIdb?: IDBFactory }).__navsahyogIdb = factory;
}

function idbFactory(): IDBFactory {
  const override = (globalThis as { __navsahyogIdb?: IDBFactory })
    .__navsahyogIdb;
  if (override) return override;
  if (typeof indexedDB === 'undefined') {
    throw new Error('indexedDB is not available in this environment');
  }
  return indexedDB;
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = idbFactory().open(DB_NAME, LATEST_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction!;
      const oldV = event.oldVersion ?? 0;
      const newV = event.newVersion ?? LATEST_VERSION;
      // Run every migration step strictly newer than the existing
      // version. `oldV` is 0 for first install, equal to a previous
      // LATEST_VERSION for in-place upgrades.
      for (let v = oldV; v < newV; v++) {
        migrations[v]!(db, tx);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
    req.onblocked = () =>
      reject(new Error('idb open blocked by another connection'));
  });
  return dbPromise;
}

// Test hook — closes any cached open connection and drops the
// singleton so the next openDb() re-runs the upgrade path. Pair
// with `deleteDatabase` if a test wants a fully fresh DB.
export async function _resetDb(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // Open never completed; nothing to close.
    }
  }
  dbPromise = null;
}

export async function deleteDatabase(): Promise<void> {
  // IDB's delete request fires `onblocked` if any connection to the
  // database is still open. Close the cached connection first so
  // `delete` runs cleanly across test cases.
  await _resetDb();
  await new Promise<void>((resolve, reject) => {
    const req = idbFactory().deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('idb delete failed'));
    req.onblocked = () => reject(new Error('idb delete blocked'));
  });
}

// ---------------------------------------------------------------------------
// Promise wrappers
// ---------------------------------------------------------------------------

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb request failed'));
  });
}

export type IdbStoreName = 'outbox';

export async function tx<T>(
  storeNames: IdbStoreName | IdbStoreName[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(names, mode);
    let result: T;
    let resolved = false;
    Promise.resolve(body(t))
      .then((r) => {
        result = r;
        resolved = true;
      })
      .catch(reject);
    t.oncomplete = () => {
      if (resolved) resolve(result);
    };
    t.onerror = () => reject(t.error ?? new Error('idb tx failed'));
    t.onabort = () => reject(t.error ?? new Error('idb tx aborted'));
  });
}

// Generic helpers — typed over the union of valid store names so
// typos cost a typecheck error.
export async function dbPut<T>(
  store: IdbStoreName,
  value: T,
): Promise<IDBValidKey> {
  return tx(store, 'readwrite', (t) => wrap(t.objectStore(store).put(value)));
}

export async function dbGet<T>(
  store: IdbStoreName,
  key: IDBValidKey,
): Promise<T | undefined> {
  return tx(store, 'readonly', (t) =>
    wrap<T | undefined>(t.objectStore(store).get(key) as IDBRequest<T | undefined>),
  );
}

export async function dbDelete(
  store: IdbStoreName,
  key: IDBValidKey,
): Promise<void> {
  await tx(store, 'readwrite', (t) => wrap(t.objectStore(store).delete(key)));
}

export async function dbGetAll<T>(store: IdbStoreName): Promise<T[]> {
  return tx(store, 'readonly', (t) =>
    wrap<T[]>(t.objectStore(store).getAll() as IDBRequest<T[]>),
  );
}

export async function dbCount(
  store: IdbStoreName,
  query?: IDBKeyRange | IDBValidKey,
): Promise<number> {
  return tx(store, 'readonly', (t) =>
    wrap<number>(t.objectStore(store).count(query)),
  );
}

// Cursor walk — invokes `visit` for each row in key order until it
// returns `false` (early-stop) or the cursor exhausts. Useful for
// the drain runner's "find the oldest due-now row" without paging
// the whole store into memory.
export async function dbWalk<T>(
  store: IdbStoreName,
  indexName: string | null,
  query: IDBKeyRange | IDBValidKey | null,
  direction: IDBCursorDirection,
  visit: (row: T) => boolean | void,
): Promise<void> {
  await tx(store, 'readonly', (t) => {
    return new Promise<void>((resolve, reject) => {
      const src: IDBObjectStore | IDBIndex = indexName
        ? t.objectStore(store).index(indexName)
        : t.objectStore(store);
      const req = src.openCursor(query ?? null, direction);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const stop = visit(cur.value as T);
        if (stop === false) return resolve();
        cur.continue();
      };
      req.onerror = () => reject(req.error ?? new Error('cursor failed'));
    });
  });
}
