// Outbox drain runner (L4.0b — decisions.md D29, D32).
//
// Foreground-only (level-4.md "Working principles" rule 8). Runs:
//   * on app start (SyncStateProvider's mount effect),
//   * on the `online` window event,
//   * after every enqueue (the producing workflow optionally calls
//     drain() right after to push immediately),
//   * on manual trigger from the Outbox UI.
//
// The runner is opaque — it replays whatever shape the outbox row
// carries without per-endpoint branching (level-4.md rule 4 — one
// mutation per workflow). Adding a new offline-eligible workflow
// is a route registration on the server + a single enqueue() call
// on the client; the drain code never needs to change.

import {
  BUILD_ID_HEADER,
  SCHEMA_VERSION_HEADER,
  type OutboxRow,
} from '@navsahyog/shared';
import { UPGRADE_REQUIRED_EVENT } from './events';
import {
  gcDone,
  markDeadLetter,
  markDone,
  markFailed,
  markInFlight,
  pickNextDue,
} from './outbox';

// HTTP statuses that should retry rather than dead-letter. Server
// errors, request timeouts, "too early" replays, and rate limits
// all fit; everything else in the 4xx range is a contract violation
// the user has to address (re-edit or discard).
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

// HTTP status that latches the upgrade-required banner and stops
// the drain. The compat middleware (apps/api/src/lib/build.ts) is
// the only emitter today; future server-side gates can reuse the
// same status.
const UPGRADE_REQUIRED_STATUS = 426;

// Single-flight guard. A second drain() call while one is running
// returns the in-flight promise instead of starting a parallel loop
// — IDB transactions don't compose well across loops.
let inFlight: Promise<DrainResult> | null = null;

export type DrainResult = {
  drained: number;
  failed: number;
  deadLettered: number;
  upgrade_required: boolean;
};

// Predicate for the network. Drains never run while offline; the
// SyncStateProvider only triggers drain() when network reads as
// 'online'. Tests can pass a stub.
export type DrainOptions = {
  fetchImpl?: typeof fetch;
  isOnline?: () => boolean;
  // The maximum number of rows to drain in one invocation. Defaults
  // to a generous 200 so a typical-day backlog clears in one pass;
  // bounded so a buggy server doesn't pin the loop indefinitely.
  maxRows?: number;
};

const DEFAULT_MAX_ROWS = 200;

export async function drain(
  options: DrainOptions = {},
): Promise<DrainResult> {
  if (inFlight) return inFlight;
  inFlight = drainOnce(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function drainOnce(options: DrainOptions): Promise<DrainResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const isOnline = options.isOnline ?? (() => true);
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  const result: DrainResult = {
    drained: 0,
    failed: 0,
    deadLettered: 0,
    upgrade_required: false,
  };

  for (let i = 0; i < maxRows; i++) {
    if (!isOnline()) break;
    const row = await pickNextDue();
    if (!row) break;
    await markInFlight(row.idempotency_key);
    const verdict = await sendOnce(row, fetchImpl);
    if (verdict.kind === 'ok') {
      await markDone(row.idempotency_key);
      result.drained++;
    } else if (verdict.kind === 'upgrade_required') {
      // Don't bump attempts. The row stays in_flight transiently;
      // reset to pending so the next drain (after upgrade) picks it
      // up again. Latch the banner via the same event api.ts uses.
      await markFailed(
        row.idempotency_key,
        '426 upgrade_required — refresh the app',
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(UPGRADE_REQUIRED_EVENT));
      }
      result.upgrade_required = true;
      break;
    } else if (verdict.kind === 'terminal') {
      await markDeadLetter(row.idempotency_key, verdict.summary);
      result.deadLettered++;
    } else {
      // verdict.kind === 'retryable'
      await markFailed(row.idempotency_key, verdict.summary);
      result.failed++;
    }
  }

  // Sweep `done` rows older than the retention window so the queue
  // doesn't grow unboundedly on chatty workflows.
  await gcDone();

  return result;
}

type SendVerdict =
  | { kind: 'ok' }
  | { kind: 'upgrade_required' }
  | { kind: 'terminal'; summary: string }
  | { kind: 'retryable'; summary: string };

async function sendOnce(
  row: OutboxRow,
  fetchImpl: typeof fetch,
): Promise<SendVerdict> {
  let res: Response;
  try {
    res = await fetchImpl(row.path, {
      method: row.method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        [BUILD_ID_HEADER]: row.build_id,
        [SCHEMA_VERSION_HEADER]: String(row.schema_version),
        'Idempotency-Key': row.idempotency_key,
      },
      body: row.body === undefined ? undefined : JSON.stringify(row.body),
    });
  } catch (e) {
    // Network errors — no Response. Always retryable.
    const summary = e instanceof Error ? e.message : 'network error';
    return { kind: 'retryable', summary: `network: ${summary}` };
  }

  if (res.ok) return { kind: 'ok' };
  if (res.status === UPGRADE_REQUIRED_STATUS) return { kind: 'upgrade_required' };

  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  const summary = `${res.status} ${
    body.error?.message ?? body.error?.code ?? 'http error'
  }`;

  if (RETRYABLE_STATUSES.has(res.status)) {
    return { kind: 'retryable', summary };
  }
  // Anything else in the 4xx range is a contract violation the user
  // has to resolve (validation, conflict, auth). Dead-letter so the
  // dead-letter UI surfaces it.
  return { kind: 'terminal', summary };
}
