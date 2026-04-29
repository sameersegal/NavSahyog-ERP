// Real-network detection (L4.0a — level-4.md "Working principles" rule 8).
//
// `navigator.onLine` lies — captive portals and hotel wifi return
// `true` even when no actual internet is reachable. We probe `/health`
// (the unauthenticated liveness endpoint) with a short timeout and
// treat any failure as offline. The result is cached for a short
// window so a UI rerender doesn't trigger a fresh probe each frame.

const PROBE_PATH = '/health';
const PROBE_TIMEOUT_MS = 3_000;
// TTL is asymmetric: a confirmed-online result is held for 30s so a
// chatty UI doesn't refire probes constantly; a confirmed-offline
// result is held for 2 minutes so an iOS PWA in airplane mode isn't
// burning a 3s timeout every 30s on the bare chance the radio came
// back. The `online` window event still force-probes immediately,
// so the back-off only delays passive recovery, not active.
const CACHE_TTL_ONLINE_MS = 30_000;
const CACHE_TTL_OFFLINE_MS = 2 * 60_000;

export type NetworkStatus = 'online' | 'offline' | 'unknown';

type CacheEntry = {
  status: NetworkStatus;
  expiresAt: number;
};

let cache: CacheEntry | null = null;
let inFlight: Promise<NetworkStatus> | null = null;

// Lower-level probe — used by the public detector and exposed for
// tests that want to bypass the cache.
async function rawProbe(signal?: AbortSignal): Promise<NetworkStatus> {
  if (typeof fetch !== 'function') return 'unknown';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  // If the caller supplied a signal, propagate aborts both ways.
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(PROBE_PATH, {
      method: 'HEAD',
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    return res.ok ? 'online' : 'offline';
  } catch {
    return 'offline';
  } finally {
    clearTimeout(timer);
  }
}

export async function detectNetwork(
  options: { force?: boolean } = {},
): Promise<NetworkStatus> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) {
    return cache.status;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const status = await rawProbe();
      const ttl =
        status === 'offline' ? CACHE_TTL_OFFLINE_MS : CACHE_TTL_ONLINE_MS;
      cache = { status, expiresAt: Date.now() + ttl };
      return status;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// Test hook — clears the cache so each test gets a fresh probe.
export function _resetNetworkCache(): void {
  cache = null;
  inFlight = null;
}
