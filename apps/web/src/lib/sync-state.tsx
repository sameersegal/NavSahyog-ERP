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
import { UPGRADE_REQUIRED_EVENT } from './events';
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

const PROBE_INTERVAL_MS = 30_000;

export function SyncStateProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<NetworkStatus>('unknown');
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [outbox, setOutbox] = useState<OutboxCounts>(ZERO_COUNTS);

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
  // keeps the actual network traffic light.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void probe();
    };
    tick();
    const interval = window.setInterval(tick, PROBE_INTERVAL_MS);
    const handleOnline = () => {
      void probe(true);
      // Coming back online — drain whatever's queued.
      void syncNow();
    };
    const handleOffline = () => setNetwork('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // syncNow depends on `network`; we deliberately don't refire the
    // mount effect on every network change (the probe + listeners
    // handle that). Captured `syncNow` reads `network` via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe]);

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

  const state = reduceState({ network, upgradeRequired, outbox });

  const value = useMemo<SyncStateValue>(
    () => ({
      state,
      network,
      outbox,
      refresh: () => void probe(true),
      syncNow,
    }),
    [state, network, outbox, probe, syncNow],
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
