// Jal Vriddhi pond list (§3.10). Lists every pond in scope with its
// farmer, latest agreement, and a link into the detail page where
// the VC can re-upload a newer version.
//
// Read-only roles see the list; only `pond.write` carries the
// "Add pond" CTA. The list endpoint is already scope-filtered server
// side (villageIdsInScope), so the client just renders.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, can, type PondListItem } from '../api';
import { OfflineUnavailable } from '../components/OfflineUnavailable';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { absoluteTime } from '../lib/date';
import { useSyncState } from '../lib/sync-state';

export function Ponds() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { network } = useSyncState();
  const [ponds, setPonds] = useState<PondListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.ponds()
      .then((r) => setPonds(r.ponds))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  const canWrite = can(user, 'pond.write');

  // §3.10 ponds list is `online-only` (D25). Match the L4.0f Home /
  // Dashboard pattern: when the load fails AND the network reads as
  // offline, render OfflineUnavailable instead of a raw error /
  // forever-loading.
  const browserOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false;
  const isOffline = network === 'offline' || browserOffline;
  if ((error || ponds === null) && isOffline) return <OfflineUnavailable />;
  if (error) return <p className="text-danger">{error}</p>;
  if (ponds === null) return <p className="text-muted-fg">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('pond.list.title')}</h1>
        {canWrite && (
          <Link
            to="/ponds/new"
            className="bg-primary hover:bg-primary-hover text-primary-fg rounded px-3 py-1.5 text-sm min-h-[44px] inline-flex items-center"
          >
            <span aria-hidden="true" className="mr-1">+</span>
            {t('pond.list.add')}
          </Link>
        )}
      </header>

      {ponds.length === 0 ? (
        <p className="text-sm text-muted-fg">{t('pond.list.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {ponds.map((p) => (
            <li
              key={p.pond.id}
              className="bg-card border border-border rounded-lg"
            >
              <Link
                to={`/ponds/${p.pond.id}`}
                className="block p-3 hover:bg-card-hover min-h-[44px]"
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.farmer.full_name}</div>
                    <div className="text-xs text-muted-fg truncate">
                      {p.village_name}
                      {p.farmer.plot_identifier
                        ? ` · ${p.farmer.plot_identifier}`
                        : ''}
                    </div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-card-hover border border-border text-muted-fg">
                    {t(`pond.status.${p.pond.status}` as const)}
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs text-muted-fg">
                  <div className="truncate">
                    {t('pond.list.gps', {
                      lat: p.pond.latitude.toFixed(5),
                      lng: p.pond.longitude.toFixed(5),
                    })}
                  </div>
                  <div className="truncate text-right">
                    {p.latest_agreement
                      ? t('pond.list.versions', { n: p.agreement_count })
                      : t('pond.list.no_agreement')}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-fg">
                  {t('pond.list.created', {
                    when: absoluteTime(p.pond.created_at, lang),
                  })}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
