// Read-only catalogue of training manuals (§3.8.8). Every
// authenticated role carries `training_manual.read`; the route is
// reachable from the main nav. Authoring lives in Master Creations
// (Super-Admin only).
//
// Display rules: group by category, links open in a new tab,
// updated_at rendered as a localized date for "knowing what's
// fresh" without exposing the full epoch.

import { useEffect, useMemo, useState } from 'react';
import { api, type TrainingManual } from '../api';
import { OfflineUnavailable } from '../components/OfflineUnavailable';
import { useI18n } from '../i18n';
import { useSyncState } from '../lib/sync-state';

export function TrainingManuals() {
  const { t, lang } = useI18n();
  const { network } = useSyncState();
  const [rows, setRows] = useState<TrainingManual[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .trainingManuals()
      .then((r) => setRows(r.manuals))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, TrainingManual[]>();
    for (const m of rows ?? []) {
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }),
    );
  }, [rows]);

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [lang],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('manuals.title')}</h2>
        <p className="text-sm text-muted-fg">{t('manuals.description')}</p>
      </div>

      {(() => {
        // §3.8.8 manuals are `online-only` (the catalogue is authored
        // server-side; manuals open in a new tab and need network
        // anyway). Match L4.0f Home / Dashboard pattern when offline.
        const browserOffline =
          typeof navigator !== 'undefined' && navigator.onLine === false;
        const isOffline = network === 'offline' || browserOffline;
        if ((err || rows === null) && isOffline) return <OfflineUnavailable />;
        if (err) return <div className="text-sm text-danger">{err}</div>;
        if (rows === null) return <div className="text-sm text-muted-fg">{t('common.loading')}</div>;
        if (rows.length === 0) return <div className="text-sm text-muted-fg">{t('manuals.empty')}</div>;
        return null;
      })()}

      {groups.map(([category, manuals]) => (
        <section key={category} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-fg">
            {category}
          </h3>
          <ul className="space-y-2">
            {manuals.map((m) => (
              <li
                key={m.id}
                className="border border-border rounded-lg p-3 bg-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
              >
                <a
                  href={m.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary hover:underline font-medium break-all"
                >
                  {m.name}
                </a>
                <span className="text-xs text-muted-fg shrink-0">
                  {t('manuals.updated_at', {
                    when: fmt.format(new Date(m.updated_at * 1000)),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
