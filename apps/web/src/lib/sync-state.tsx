// Sync-state taxonomy + chrome chip + force-upgrade banner
// (L4.0a — decisions.md D29, D32; level-4.md "Working principles" rule 5).
//
// Single source of truth for the green / yellow / red / update_required
// indicator surfaced in the app header. Two signals feed it today:
//   * Real network detectability (lib/network.ts HEAD probe). Offline
//     → red.
//   * 426 responses from the API (api.ts dispatches an event on
//     `UPGRADE_REQUIRED_EVENT`). 426 → update_required, latched
//     until the page reloads.
//
// Future signals (outbox queued count, dead-letter presence) plug in
// here when L4.0b ships.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SyncState } from '@navsahyog/shared';
import { useI18n } from '../i18n';
import { UPGRADE_REQUIRED_EVENT } from '../api';
import { detectNetwork, type NetworkStatus } from './network';

type SyncStateValue = {
  state: SyncState;
  network: NetworkStatus;
  refresh: () => void;
};

const Ctx = createContext<SyncStateValue | null>(null);

const PROBE_INTERVAL_MS = 30_000;

export function SyncStateProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<NetworkStatus>('unknown');
  const [upgradeRequired, setUpgradeRequired] = useState(false);

  const probe = useCallback(async (force = false) => {
    const result = await detectNetwork({ force });
    setNetwork(result);
  }, []);

  // Initial probe + interval. We deliberately use a HEAD probe rather
  // than `navigator.onLine` (level-4.md rule 8). The cache inside
  // detectNetwork keeps the actual network traffic light.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void probe();
    };
    tick();
    const interval = window.setInterval(tick, PROBE_INTERVAL_MS);
    const handleOnline = () => void probe(true);
    const handleOffline = () => setNetwork('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [probe]);

  // 426 latch. Once the server has rejected a request as too old,
  // any subsequent request from the same client will keep failing
  // until the user refreshes — so we keep the banner up.
  useEffect(() => {
    const handler = () => setUpgradeRequired(true);
    window.addEventListener(UPGRADE_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(UPGRADE_REQUIRED_EVENT, handler);
  }, []);

  const state: SyncState = upgradeRequired
    ? 'update_required'
    : network === 'offline'
      ? 'red'
      : 'green';

  const value = useMemo<SyncStateValue>(
    () => ({ state, network, refresh: () => void probe(true) }),
    [state, network, probe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSyncState(): SyncStateValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Outside the provider — return a benign default rather than
    // throwing. Login screen (which mounts before the provider in
    // some flows) shouldn't crash because of an indicator chip.
    return { state: 'green', network: 'unknown', refresh: () => {} };
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
  const { state } = useSyncState();
  const label =
    state === 'green'
      ? t('sync.green')
      : state === 'yellow'
        ? t('sync.yellow')
        : state === 'red'
          ? t('sync.red')
          : t('sync.update_required.label');
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
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
    </span>
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
