// Sync-state taxonomy + chrome chip + force-upgrade banner
// (L4.0a/b — decisions.md D29, D32; level-4.md "Working principles" rule 5).
//
// Single source of truth for the green / yellow / red / update_required
// indicator surfaced in the app header. Signals feeding it:
//   * Real network detectability (lib/network.ts HEAD probe). Offline
//     → red.
//   * 426 responses from the API (api.ts + drain.ts dispatch an event
//     on `UPGRADE_REQUIRED_EVENT`). 426 → update_required, latched
//     until the page reloads.
//   * Outbox state (lib/outbox.ts emits OUTBOX_CHANGED_EVENT after
//     every mutation). Pending / in_flight / failed → yellow;
//     dead_letter → red (action required).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import type { SyncState } from '@navsahyog/shared';
import { useI18n } from '../i18n';
import {
  UPGRADE_REQUIRED_EVENT,
  SERVER_BUILD_OBSERVED_EVENT,
  type ServerBuildObservedDetail,
} from './events';
import { detectNetwork, type NetworkStatus } from './network';
import { counts as outboxCounts, OUTBOX_CHANGED_EVENT } from './outbox';
import { drain } from './drain';

type OutboxCounts = {
  pending: number;
  in_flight: number;
  failed: number;
  dead_letter: number;
};

type SyncStateValue = {
  state: SyncState;
  network: NetworkStatus;
  outbox: OutboxCounts;
  // Most recent newer server build the client has observed via
  // `X-Server-Build`. Drives the soft, dismissible "Update available"
  // banner. `null` until either no signal has arrived or the user
  // dismissed it for the current session.
  newerServerBuild: string | null;
  dismissUpdateAvailable: () => void;
  refresh: () => void;
  syncNow: () => Promise<void>;
};

const ZERO_COUNTS: OutboxCounts = {
  pending: 0,
  in_flight: 0,
  failed: 0,
  dead_letter: 0,
};

const Ctx = createContext<SyncStateValue | null>(null);

// Interval at which the chrome re-checks network state. Asymmetric:
// when we believe we're online we poll briskly so a connectivity
// drop is reflected within ~30s; when we believe we're offline we
// stretch the interval so an idle PWA on airplane mode isn't pinging
// every 30s. The `online` window event still triggers an immediate
// force-probe regardless, so recovery is event-driven, not poll-bound.
const PROBE_INTERVAL_ONLINE_MS = 30_000;
const PROBE_INTERVAL_OFFLINE_MS = 2 * 60_000;

export function SyncStateProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<NetworkStatus>('unknown');
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [outbox, setOutbox] = useState<OutboxCounts>(ZERO_COUNTS);
  const [newerServerBuild, setNewerServerBuild] = useState<string | null>(null);
  const [dismissedBuild, setDismissedBuild] = useState<string | null>(null);

  const probe = useCallback(async (force = false) => {
    const result = await detectNetwork({ force });
    setNetwork(result);
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const c = await outboxCounts();
      setOutbox({
        pending: c.pending,
        in_flight: c.in_flight,
        failed: c.failed,
        dead_letter: c.dead_letter,
      });
    } catch {
      // IDB may be unavailable (private browsing, quota, jsdom in a
      // test that didn't install fake-indexeddb). Treat as empty
      // outbox rather than crashing the chip.
      setOutbox(ZERO_COUNTS);
    }
  }, []);

  const syncNow = useCallback(async () => {
    await drain({ isOnline: () => network !== 'offline' });
    await refreshCounts();
  }, [network, refreshCounts]);

  // Initial network probe + interval. The cache inside detectNetwork
  // keeps the actual network traffic light. Interval is rescheduled
  // off the latest known network state via a recursive setTimeout,
  // so an offline-latched session backs off without churning timers
  // on every probe completion.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const schedule = () => {
      if (cancelled) return;
      const delay =
        network === 'offline'
          ? PROBE_INTERVAL_OFFLINE_MS
          : PROBE_INTERVAL_ONLINE_MS;
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        await probe();
        schedule();
      }, delay);
    };
    void probe();
    schedule();
    const handleOnline = () => {
      void probe(true);
      void syncNow();
    };
    const handleOffline = () => setNetwork('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // We depend on `network` so the next interval picks up the new
    // back-off when state changes, but `syncNow` is read via closure
    // to avoid double-firing the mount effect on every count update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe, network]);

  // Initial outbox count + subscribe to mutations from any tab/page.
  useEffect(() => {
    void refreshCounts();
    const handler = () => void refreshCounts();
    window.addEventListener(OUTBOX_CHANGED_EVENT, handler);
    return () => window.removeEventListener(OUTBOX_CHANGED_EVENT, handler);
  }, [refreshCounts]);

  // App-start drain — fire-and-forget, only if we believe we're
  // online. The drain runner itself is single-flight.
  useEffect(() => {
    if (network !== 'online') return;
    void drain({ isOnline: () => true }).then(refreshCounts);
  }, [network, refreshCounts]);

  // 426 latch. Once the server has rejected a request as too old,
  // any subsequent request from the same client will keep failing
  // until the user refreshes — so we keep the banner up.
  useEffect(() => {
    const handler = () => setUpgradeRequired(true);
    window.addEventListener(UPGRADE_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(UPGRADE_REQUIRED_EVENT, handler);
  }, []);

  // Soft "Update available" — dispatched by lib/events.ts when any
  // response carries an `X-Server-Build` newer than the local build.
  // The banner is dismissible per-build; if a still-newer build
  // arrives later, the banner re-surfaces for that one.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ServerBuildObservedDetail>).detail;
      setNewerServerBuild(detail.serverBuild);
    };
    window.addEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    return () =>
      window.removeEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
  }, []);

  const state = reduceState({ network, upgradeRequired, outbox });

  const dismissUpdateAvailable = useCallback(() => {
    if (newerServerBuild) setDismissedBuild(newerServerBuild);
  }, [newerServerBuild]);

  // Hide the banner if the user already dismissed *this* build. A
  // later, even-newer build resets the dismissal automatically.
  const visibleNewerBuild =
    newerServerBuild && newerServerBuild !== dismissedBuild
      ? newerServerBuild
      : null;

  const value = useMemo<SyncStateValue>(
    () => ({
      state,
      network,
      outbox,
      newerServerBuild: visibleNewerBuild,
      dismissUpdateAvailable,
      refresh: () => void probe(true),
      syncNow,
    }),
    [state, network, outbox, visibleNewerBuild, dismissUpdateAvailable, probe, syncNow],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// State reduction. Pure function — exported for tests.
//
//   update_required → highest priority (latched on 426).
//   dead_letter > 0 → red (user action required).
//   network offline → red.
//   anything in flight or queued → yellow.
//   else → green.
export function reduceState(args: {
  network: NetworkStatus;
  upgradeRequired: boolean;
  outbox: OutboxCounts;
}): SyncState {
  if (args.upgradeRequired) return 'update_required';
  if (args.outbox.dead_letter > 0) return 'red';
  if (args.network === 'offline') return 'red';
  if (
    args.outbox.pending > 0 ||
    args.outbox.in_flight > 0 ||
    args.outbox.failed > 0
  ) {
    return 'yellow';
  }
  return 'green';
}

export function useSyncState(): SyncStateValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Outside the provider — return a benign default rather than
    // throwing. Login screen (which mounts before the provider in
    // some flows) shouldn't crash because of an indicator chip.
    return {
      state: 'green',
      network: 'unknown',
      outbox: ZERO_COUNTS,
      newerServerBuild: null,
      dismissUpdateAvailable: () => {},
      refresh: () => {},
      syncNow: async () => {},
    };
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Chip (header)
// ---------------------------------------------------------------------------

const CHIP_STYLE: Record<SyncState, string> = {
  green: 'bg-white/15 text-primary-fg',
  yellow: 'bg-amber-400/30 text-primary-fg',
  red: 'bg-rose-500/40 text-primary-fg',
  update_required: 'bg-amber-400 text-amber-950',
};

const DOT_STYLE: Record<SyncState, string> = {
  green: 'bg-emerald-300',
  yellow: 'bg-amber-300',
  red: 'bg-rose-300',
  update_required: 'bg-amber-700',
};

export function SyncChip() {
  const { t } = useI18n();
  const { state, network, outbox } = useSyncState();
  const queued = outbox.pending + outbox.in_flight + outbox.failed;

  // Label is finer-grained than the SyncState enum:
  //   * yellow → "{n} queued" so the user sees backlog at a glance.
  //   * red → distinguish "Offline" (network down) from "Action
  //     required" (dead-letter present and online).
  let label: string;
  if (state === 'update_required') {
    label = t('sync.update_required.label');
  } else if (state === 'yellow') {
    label = t('sync.yellow.queued', { n: queued });
  } else if (state === 'red') {
    label =
      outbox.dead_letter > 0
        ? t('sync.red.action_required')
        : t('sync.red.offline');
  } else {
    label = t('sync.green');
  }
  // Title carries the underlying network state for diagnostics on
  // hover, even when the visible label is about the dead-letter.
  const title = network === 'offline' ? `${label} · ${t('sync.red.offline')}` : label;
  return (
    <Link
      to="/outbox"
      role="status"
      aria-label={label}
      title={title}
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ' +
        CHIP_STYLE[state]
      }
    >
      <span
        aria-hidden="true"
        className={'w-2 h-2 rounded-full ' + DOT_STYLE[state]}
      />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Force-upgrade banner
// ---------------------------------------------------------------------------

export function ForceUpgradeBanner() {
  const { t } = useI18n();
  const { state } = useSyncState();
  if (state !== 'update_required') return null;
  return (
    <div
      role="alert"
      className="bg-amber-400 text-amber-950 px-4 py-3 text-sm flex items-center justify-between gap-3 border-b border-amber-500"
    >
      <div className="min-w-0">
        <p className="font-semibold">{t('sync.update_required.title')}</p>
        <p className="text-amber-900">{t('sync.update_required.body')}</p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded bg-amber-950 text-amber-50 px-3 py-1.5 text-xs font-semibold hover:bg-amber-900"
      >
        {t('sync.update_required.action')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Update available banner (L4.0c — soft, dismissible)
// ---------------------------------------------------------------------------
//
// Shown when the client observed a newer SERVER_BUILD_ID via the
// `X-Server-Build` response header. Dismissal is per-build — if a
// still-newer build appears later, the banner re-surfaces.
// Suppressed when the force-upgrade banner is up so the user only
// sees one update prompt at a time.

export function UpdateAvailableBanner() {
  const { t } = useI18n();
  const { state, newerServerBuild, dismissUpdateAvailable } = useSyncState();
  if (state === 'update_required') return null;
  if (!newerServerBuild) return null;
  return (
    <div
      role="status"
      className="bg-sky-100 text-sky-950 px-4 py-2.5 text-sm flex items-center justify-between gap-3 border-b border-sky-200"
    >
      <div className="min-w-0">
        <p className="font-medium">{t('sync.update_available.title')}</p>
        <p className="text-sky-900 text-xs">
          {t('sync.update_available.body', { build: newerServerBuild })}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <button
          type="button"
          onClick={dismissUpdateAvailable}
          className="text-xs rounded border border-sky-300 px-2 py-1 hover:bg-sky-200"
        >
          {t('sync.update_available.dismiss')}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-xs rounded bg-sky-700 text-sky-50 px-3 py-1.5 font-semibold hover:bg-sky-800"
        >
          {t('sync.update_available.action')}
        </button>
      </div>
    </div>
  );
}
