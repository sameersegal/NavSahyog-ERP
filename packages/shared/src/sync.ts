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

// Pure compat check. Server middleware uses this directly; the client
// uses it to predict a 426 before sending (so it can surface the
// "Update required" screen without round-tripping to find out).
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
