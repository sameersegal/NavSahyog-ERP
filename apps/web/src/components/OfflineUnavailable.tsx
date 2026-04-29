// Spec'd offline empty state for read screens whose endpoints are
// `online-only` per requirements/offline-scope.md (§3.6 dashboards,
// §3.6.4 Field-Dashboard Home, etc.). Replaces the "stuck on loading
// skeleton" or raw-error rendering when the failure is actually a
// network gap rather than a server problem.

import { useI18n } from '../i18n';

export function OfflineUnavailable() {
  const { t } = useI18n();
  return (
    <section
      role="status"
      aria-live="polite"
      className="bg-card border border-border rounded-lg p-6 text-center space-y-2"
    >
      <h2 className="text-base font-semibold">
        {t('offline.unavailable.title')}
      </h2>
      <p className="text-sm text-muted-fg">{t('offline.unavailable.body')}</p>
    </section>
  );
}
