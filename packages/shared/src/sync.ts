// Sync platform primitives (L4.0a — decisions.md D29–D32).
//
// This module is the shared vocabulary between client and server for
// the offline platform that will land progressively in L4.0–L4.2+.
// L4.0a wires only the build-id header + sync-state taxonomy; the
// outbox row shape, schema versioning, and dead-letter contract land
// in subsequent slices.

// ---------------------------------------------------------------------------
// Build identity
// ---------------------------------------------------------------------------

// Header carrying the client build identifier on every request. Server
// uses it to apply the N-7 compat window (decisions.md D31) and to
// stamp dead-letters in observability output once the outbox lands.
export const BUILD_ID_HEADER = 'X-App-Build';

// Header carrying the schema version of the request payload. Reserved
// for the outbox-replay path (L4.0b); regular online API calls leave
// it absent. Surfaced here so client and server agree on the spelling
// from the start.
export const SCHEMA_VERSION_HEADER = 'X-Schema-Version';

// Header on every server response carrying the server's own build id
// (L4.0c — decisions.md D31 deploy-grace fix). The client compares
// it against its local BUILD_ID to detect that a newer build has
// been deployed and surface the "Update available" banner. This is
// the *soft* nudge; the *hard* floor is enforced separately via
// MIN_SUPPORTED_BUILD on the server.
export const SERVER_BUILD_HEADER = 'X-Server-Build';

// Build identifier format: `YYYY-MM-DD[.<suffix>]`. The date prefix
// is what enforces the N-7 window via simple lexicographic compare;
// the optional suffix (a short git SHA in CI, a literal "dev" locally)
// is for diagnostics only. Anything that doesn't match is treated as
// `null` and refused by the compat check.
const BUILD_ID_RE = /^(\d{4}-\d{2}-\d{2})(?:\.[A-Za-z0-9_-]+)?$/;

export function parseBuildDate(buildId: string | null | undefined): string | null {
  if (!buildId) return null;
  const m = BUILD_ID_RE.exec(buildId);
  return m ? m[1]! : null;
}

// Days between two ISO `YYYY-MM-DD` dates, signed (b - a). Returns
// `null` if either input doesn't parse. Pure UTC arithmetic — we
// never need wall-clock-local granularity for a 7-day window.
export function daysBetweenIso(a: string, b: string): number | null {
  const aMs = Date.parse(a + 'T00:00:00Z');
  const bMs = Date.parse(b + 'T00:00:00Z');
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return null;
  return Math.round((bMs - aMs) / 86_400_000);
}

// Default compat window — `level-4.md` "Working principles" rule 3.
// Same-day upgrade preferred, end-of-week (7 days) the hard ceiling.
export const COMPAT_WINDOW_DAYS = 7;

export type CompatVerdict =
  | { kind: 'ok' }
  | { kind: 'unknown_build' }       // header missing or malformed
  | { kind: 'too_old'; days: number }; // older than COMPAT_WINDOW_DAYS

// Pure compat check. Time-based — used by the *client* to derive the
// soft "Update available" banner once a newer SERVER_BUILD_ID has
// been observed via the response header. It is **not** what the
// server middleware uses to gate requests; that's `checkFloor` below
// (decisions.md D31 deploy-grace fix — operator-managed floor, not
// wall-clock).
export function checkCompat(
  clientBuildId: string | null | undefined,
  serverDateIso: string,
  windowDays: number = COMPAT_WINDOW_DAYS,
): CompatVerdict {
  const clientDate = parseBuildDate(clientBuildId);
  if (!clientDate) return { kind: 'unknown_build' };
  const diff = daysBetweenIso(clientDate, serverDateIso);
  if (diff === null) return { kind: 'unknown_build' };
  // Future-dated builds (clock skew on dev machines, mostly) are
  // accepted — the server is authoritative on time and a future
  // build can't have been authored against an unreleased contract.
  if (diff <= windowDays) return { kind: 'ok' };
  return { kind: 'too_old', days: diff };
}

// Hard-floor check used by the server middleware (apps/api/src/lib/build.ts).
//
// Deploy-grace semantics (decisions.md D31, L4.0c): operators set
// `MIN_SUPPORTED_BUILD` to a build-id (typically the *previous*
// deploy's build, so one-version-back keeps working through a fresh
// deploy). Anything older than that floor is 426'd. When the env
// var is unset, no floor applies and any well-formed build is
// accepted.
//
// This is intentionally not time-based — wall-clock comparisons bite
// the moment a new build lands, force-upgrading the entire fleet
// against a window the clients haven't had a chance to enter.
export function checkFloor(
  clientBuildId: string | null | undefined,
  minSupportedBuild: string | null | undefined,
): CompatVerdict {
  const clientDate = parseBuildDate(clientBuildId);
  if (!clientDate) return { kind: 'unknown_build' };
  if (!minSupportedBuild) return { kind: 'ok' };
  const floorDate = parseBuildDate(minSupportedBuild);
  if (!floorDate) return { kind: 'ok' }; // misconfigured floor — fail open
  const diff = daysBetweenIso(floorDate, clientDate);
  if (diff === null) return { kind: 'unknown_build' };
  // diff >= 0 means client is at or after the floor → ok.
  if (diff >= 0) return { kind: 'ok' };
  return { kind: 'too_old', days: -diff };
}

// Today as `YYYY-MM-DD` in UTC. Both server and client use UTC for
// the compat math so a VC's device timezone never shifts a build out
// of the window.
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Sync state taxonomy (level-4.md "Working principles" rule + L4.0a chip)
// ---------------------------------------------------------------------------
//
// The chrome-level chip surfaces this. Order matters: states later
// in the array dominate states earlier in it when reducing across
// signals.

export const SYNC_STATES = ['green', 'yellow', 'red', 'update_required'] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export function dominantState(states: readonly SyncState[]): SyncState {
  let max: SyncState = 'green';
  let maxIdx = 0;
  for (const s of states) {
    const idx = SYNC_STATES.indexOf(s);
    if (idx > maxIdx) {
      max = s;
      maxIdx = idx;
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// Outbox row shape + status taxonomy (L4.0b — decisions.md D32)
// ---------------------------------------------------------------------------
//
// The outbox is the device-local queue of mutations that haven't yet
// reached the server. Each row carries the full intent for one
// workflow (level-4.md "Working principles" rule 4 — one mutation per
// workflow), plus the build-id and schema-version that authored it
// (D31 — N-7 compat window).
//
// L4.0b ships the framework. Live workflows enqueue here in L4.1+.

export const OUTBOX_STATUSES = [
  'pending',     // waiting for the next drain
  'in_flight',   // a drain is currently fetching this row
  'failed',      // retryable error; will retry after next_attempt_at
  'dead_letter', // terminal — needs explicit user action (retry / discard)
  'done',        // server acked; row is kept briefly for audit then GC'd
] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export type OutboxRow = {
  // ULID. Stable across retries. Doubles as the `Idempotency-Key`
  // header so the server dedupes replays of the same intent (§5.1).
  idempotency_key: string;
  // ms epoch — set on enqueue, never updated. Drives drain ordering.
  created_at: number;
  // ms epoch — earliest time this row should be re-attempted.
  // For pending rows this equals created_at; for failed rows it's
  // bumped per `nextBackoffMs(attempts)` on each failure.
  next_attempt_at: number;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;       // e.g. '/api/attendance/submit'
  body: unknown;      // serialised request body
  // Schema version of the body shape this row was authored against.
  // Sent on drain as X-Schema-Version. Workflows bump this when their
  // payload contract changes (additive-only — see decisions.md D30).
  schema_version: number;
  // BUILD_ID at enqueue time. Sent on drain as X-App-Build. The
  // server's compat middleware applies the N-7 window — older rows
  // dead-letter on drain attempt rather than silently 4xx-ing.
  build_id: string;
  // 0 on enqueue; bumped on every retryable failure. Reaching
  // OUTBOX_MAX_ATTEMPTS flips status to dead_letter.
  attempts: number;
  // Last error summary (status + message) for the dead-letter UI.
  last_error: string | null;
  status: OutboxStatus;
  // Optional FK into the media_blobs store (added in a later
  // migration). Reserved here so the row shape doesn't change when
  // L4.1 wires media capture.
  media_ref?: string | null;
};

// Backoff schedule for retryable failures (§6.5). Capped at 5
// attempts before flipping to dead_letter (L4.0b's tighter version
// of the original §6.5 — same numbers, explicit cap).
export const OUTBOX_BACKOFF_MS: readonly number[] = [
  1_000,    //   1s
  5_000,    //   5s
  30_000,   //  30s
  120_000,  //   2m
  600_000,  //  10m
];
export const OUTBOX_MAX_ATTEMPTS = OUTBOX_BACKOFF_MS.length;

// ms to wait before the (attempts+1)th try, given that `attempts`
// have already failed. Returns null when the row should dead-letter
// instead (attempts >= max).
export function nextBackoffMs(attempts: number): number | null {
  if (attempts < 0) return OUTBOX_BACKOFF_MS[0]!;
  if (attempts >= OUTBOX_MAX_ATTEMPTS) return null;
  return OUTBOX_BACKOFF_MS[attempts]!;
}

// ---------------------------------------------------------------------------
// ULID — Crockford-base32 26-char time-ordered identifier (L4.0b)
// ---------------------------------------------------------------------------
//
// Deliberately tiny — vendoring rather than a dep. ULIDs sort
// lexicographically by creation time, which is what we need so the
// outbox's keyPath gives us natural ordering without a secondary
// index on created_at.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(ms: number, len: number): string {
  let n = Math.floor(ms);
  let out = '';
  for (let i = 0; i < len; i++) {
    out = CROCKFORD[n % 32]! + out;
    n = Math.floor(n / 32);
  }
  return out;
}

// Minimal structural shape of crypto.getRandomValues. Avoids
// depending on lib.dom.d.ts in this DOM-free package.
type RngHost = {
  crypto?: { getRandomValues?: (buf: Uint32Array) => Uint32Array };
};

// Monotonic state — when ulid() is called twice in the same ms, we
// reuse the prior random suffix and increment it as a base-32
// number. This makes the result strictly ascending across same-ms
// calls, which the outbox depends on (the by_next_attempt_at index
// uses created_at = enqueue ms, and we need stable ordering across
// rows enqueued in the same tick).
let lastMs = -1;
let lastRandomSyms: number[] = [];

function defaultRandomSym(): number {
  const c = (globalThis as RngHost).crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0]! % 32;
  }
  return Math.floor(Math.random() * 32);
}

// Increment a base-32 array in place, big-endian (index 0 is the
// most significant digit). Returns true on overflow — overflow is
// astronomically unlikely (16 base-32 digits = 2^80 values per ms)
// and only happens in deliberately-broken tests.
function increment32(syms: number[]): boolean {
  for (let i = syms.length - 1; i >= 0; i--) {
    if (syms[i]! < 31) {
      syms[i] = syms[i]! + 1;
      return false;
    }
    syms[i] = 0;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Manifest snapshot (L4.1a — D32 replace-snapshot, supersedes §6.9 deltas)
// ---------------------------------------------------------------------------
//
// The full read-cache scope for an authenticated user. The client
// wipes its `cache_villages` and `cache_students` IDB stores and
// reseeds from this response; the rule is "what's in the response
// is what's in the cache". Per offline-scope.md "Scope-bound
// caching", this is kilobytes for a VC.
//
// Schema is **additive-only** under D30. New nullable fields, new
// arrays, new objects on existing entries are all fine. Renames or
// removals are not — they require a new endpoint version.

export type ManifestVillage = {
  id: number;
  name: string;
  code: string;
  cluster_id: number;
  cluster_name: string;
};

export type ManifestStudent = {
  id: number;
  village_id: number;
  school_id: number;
  first_name: string;
  last_name: string;
};

export type ManifestResponse = {
  // Server epoch seconds. Stored as `last_synced_at` on the client
  // for diagnostics; not used for delta calc (D32).
  generated_at: number;
  scope: {
    level: string;
    id: number | null;
    village_ids: number[];
  };
  villages: ManifestVillage[];
  students: ManifestStudent[];
};

// `rng` returns a number in [0, 1) — exposed for deterministic tests.
// When omitted, the implementation prefers crypto.getRandomValues and
// falls back to Math.random.
export function ulid(now: number = Date.now(), rng?: () => number): string {
  // Build the random tail. With a custom rng, skip the monotonic
  // shortcut so tests stay reproducible across same-ms calls.
  let randomSyms: number[];
  if (rng) {
    randomSyms = [];
    for (let i = 0; i < 16; i++) randomSyms.push(Math.floor(rng() * 32));
  } else if (now === lastMs && lastRandomSyms.length === 16) {
    // Same ms — increment the prior tail to keep ordering monotonic.
    randomSyms = lastRandomSyms.slice();
    increment32(randomSyms);
  } else {
    randomSyms = [];
    for (let i = 0; i < 16; i++) randomSyms.push(defaultRandomSym());
  }
  if (!rng) {
    lastMs = now;
    lastRandomSyms = randomSyms;
  }
  let tail = '';
  for (const s of randomSyms) tail += CROCKFORD[s]!;
  return encodeTime(now, 10) + tail;
}
