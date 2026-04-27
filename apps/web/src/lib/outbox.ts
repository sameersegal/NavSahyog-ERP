// Outbox queue (L4.0b — decisions.md D29, D32; level-4.md "Working
// principles" rule 10 — hard cap).
//
// The single device-local queue of mutations awaiting the server.
// L4.0b ships the framework — enqueue, peek-next-due, mark-in-flight,
// mark-failed-or-dead-letter, mark-done, discard, retry. Live
// workflows opt in to enqueue() in L4.1+.
//
// Every mutation dispatches `OUTBOX_CHANGED_EVENT` on the window so
// the sync-state provider and the outbox UI can re-query counts
// without polling.

import {
  OUTBOX_MAX_ATTEMPTS,
  nextBackoffMs,
  ulid,
  type OutboxRow,
  type OutboxStatus,
} from '@navsahyog/shared';
import { BUILD_ID } from './build';
import {
  dbCount,
  dbDelete,
  dbGet,
  dbGetAll,
  dbPut,
  dbWalk,
  tx,
} from './idb';

export const OUTBOX_CHANGED_EVENT = 'navsahyog:outbox-changed';

// level-4.md "Working principles" rule 10. Past this cap, enqueue
// throws — the calling workflow surfaces a "you're past the offline
// limit, sync now" message rather than the queue silently growing.
export const OUTBOX_HARD_CAP = 100;

export class OutboxFullError extends Error {
  constructor(public readonly count: number) {
    super(
      `Outbox is at the hard cap (${count}/${OUTBOX_HARD_CAP}). ` +
        `Sync now or discard old items before queuing more.`,
    );
    this.name = 'OutboxFullError';
  }
}

export type EnqueueRequest = {
  method: OutboxRow['method'];
  path: string;
  body: unknown;
  schema_version: number;
  // Optional caller-supplied key for cross-device correlation; leave
  // undefined to mint a fresh ULID on the spot.
  idempotency_key?: string;
  media_ref?: string | null;
};

function emitChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT));
}

// Counts that the dead-letter cap and the chip both care about.
// Reading via dbCount on an index is cheaper than getAll + filter
// once the queue grows beyond a handful of rows.
async function countByStatus(status: OutboxStatus): Promise<number> {
  return tx('outbox', 'readonly', (t) => {
    return new Promise<number>((resolve, reject) => {
      const idx = t.objectStore('outbox').index('by_status');
      const req = idx.count(status);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('count failed'));
    });
  });
}

export async function counts(): Promise<{
  pending: number;
  in_flight: number;
  failed: number;
  dead_letter: number;
  done: number;
  total: number;
}> {
  const [pending, in_flight, failed, dead_letter, done, total] =
    await Promise.all([
      countByStatus('pending'),
      countByStatus('in_flight'),
      countByStatus('failed'),
      countByStatus('dead_letter'),
      countByStatus('done'),
      dbCount('outbox'),
    ]);
  return { pending, in_flight, failed, dead_letter, done, total };
}

// Enqueue a fresh mutation. Refuses past the hard cap. Note the cap
// counts every row including dead-letters and `done` (until GC) so a
// device with a backlog of failures can't accept more — that's the
// intended pressure to make the user open the outbox screen.
export async function enqueue(req: EnqueueRequest): Promise<OutboxRow> {
  const total = await dbCount('outbox');
  if (total >= OUTBOX_HARD_CAP) throw new OutboxFullError(total);

  const now = Date.now();
  const row: OutboxRow = {
    idempotency_key: req.idempotency_key ?? ulid(now),
    created_at: now,
    next_attempt_at: now,
    method: req.method,
    path: req.path,
    body: req.body,
    schema_version: req.schema_version,
    build_id: BUILD_ID,
    attempts: 0,
    last_error: null,
    status: 'pending',
    media_ref: req.media_ref ?? null,
  };
  await dbPut('outbox', row);
  emitChanged();
  return row;
}

// Drain runner's pick. Returns the oldest row that's pending OR
// failed-with-due-now-retry, or null if nothing is currently due.
// Walks the by_next_attempt_at index in ascending order and stops at
// the first match — the index keeps this O(log n + k) for k matches.
export async function pickNextDue(now: number = Date.now()): Promise<
  OutboxRow | null
> {
  let found: OutboxRow | null = null;
  await dbWalk<OutboxRow>(
    'outbox',
    'by_next_attempt_at',
    IDBKeyRange.upperBound(now),
    'next',
    (row) => {
      if (row.status === 'pending' || row.status === 'failed') {
        found = row;
        return false; // stop early
      }
      return undefined;
    },
  );
  return found;
}

export async function listAll(): Promise<OutboxRow[]> {
  const rows = await dbGetAll<OutboxRow>('outbox');
  // dbGetAll returns rows in keyPath order — ULID prefixes by time,
  // so this naturally sorts oldest-first. Good enough for the UI.
  return rows;
}

export async function listByStatus(status: OutboxStatus): Promise<OutboxRow[]> {
  const rows = await dbGetAll<OutboxRow>('outbox');
  return rows.filter((r) => r.status === status);
}

export async function getRow(
  idempotency_key: string,
): Promise<OutboxRow | undefined> {
  return dbGet<OutboxRow>('outbox', idempotency_key);
}

async function update(row: OutboxRow): Promise<void> {
  await dbPut('outbox', row);
  emitChanged();
}

export async function markInFlight(idempotency_key: string): Promise<void> {
  const row = await getRow(idempotency_key);
  if (!row) return;
  row.status = 'in_flight';
  await update(row);
}

export async function markDone(idempotency_key: string): Promise<void> {
  const row = await getRow(idempotency_key);
  if (!row) return;
  row.status = 'done';
  row.last_error = null;
  await update(row);
}

// Retryable failure — bumps attempts, schedules next_attempt_at via
// the backoff schedule, flips back to `pending` so pickNextDue picks
// it up again. If we've exhausted the schedule, dead_letter instead.
export async function markFailed(
  idempotency_key: string,
  errorSummary: string,
): Promise<void> {
  const row = await getRow(idempotency_key);
  if (!row) return;
  const nextAttempts = row.attempts + 1;
  const wait = nextBackoffMs(row.attempts);
  if (wait === null || nextAttempts >= OUTBOX_MAX_ATTEMPTS) {
    row.status = 'dead_letter';
    row.attempts = nextAttempts;
    row.last_error = errorSummary;
  } else {
    row.status = 'failed';
    row.attempts = nextAttempts;
    row.last_error = errorSummary;
    row.next_attempt_at = Date.now() + wait;
  }
  await update(row);
}

// Terminal client error (validation, conflict, 4xx-non-retryable) —
// dead-letters immediately without consuming the retry budget.
export async function markDeadLetter(
  idempotency_key: string,
  errorSummary: string,
): Promise<void> {
  const row = await getRow(idempotency_key);
  if (!row) return;
  row.status = 'dead_letter';
  row.last_error = errorSummary;
  await update(row);
}

// Manual user action — a dead-lettered or failed row gets reset to
// pending so the next drain reattempts it. The error stays on the
// row for diagnostics; cleared on success.
export async function retry(idempotency_key: string): Promise<void> {
  const row = await getRow(idempotency_key);
  if (!row) return;
  row.status = 'pending';
  row.attempts = 0;
  row.next_attempt_at = Date.now();
  await update(row);
}

// Manual user action — drop the row without sending. Used for
// dead-letters the user resolves out-of-band, or for items the
// user abandons.
export async function discard(idempotency_key: string): Promise<void> {
  await dbDelete('outbox', idempotency_key);
  emitChanged();
}

// GC for `done` rows. Called from the drain runner once a drain
// completes; keeps the queue from growing unboundedly while still
// letting the UI show "just synced N items" briefly.
export async function gcDone(retainMs: number = 60_000): Promise<number> {
  const cutoff = Date.now() - retainMs;
  const rows = await listByStatus('done');
  let deleted = 0;
  for (const row of rows) {
    if (row.next_attempt_at <= cutoff || row.created_at <= cutoff) {
      await dbDelete('outbox', row.idempotency_key);
      deleted++;
    }
  }
  if (deleted > 0) emitChanged();
  return deleted;
}
