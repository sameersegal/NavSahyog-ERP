// L3.1 Master Creations index (§3.8.7, decisions.md D21–D24).
//
// Landing page for the Master Creations area. The original
// six-tab single-page UI was split into one page per master so
// each is deep-linkable (/masters/<section>) and breadcrumb-able.
// This index gives Super Admin a quick at-a-glance view —
// per-master count badges + a "Manage" affordance.
//
// Capability gate (`user.write`) is enforced by the App.tsx route
// for both this index and the sub-pages.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';

type SectionKey =
  | 'villages'
  | 'schools'
  | 'events'
  | 'qualifications'
  | 'manuals'
  | 'users';

type SectionDef = {
  key: SectionKey;
  to: string;
  load: () => Promise<number>;
};

// One source of truth for the index ordering. Each section maps to
// its detail route and the count loader. We pull just `.length` off
// the existing list endpoints — no new server work required.
const SECTIONS: readonly SectionDef[] = [
  {
    key: 'villages',
    to: '/masters/villages',
    load: () => api.adminVillages().then((r) => r.villages.length),
  },
  {
    key: 'schools',
    to: '/masters/schools',
    load: () => api.adminSchools().then((r) => r.schools.length),
  },
  {
    key: 'events',
    to: '/masters/events',
    load: () => api.adminEvents().then((r) => r.events.length),
  },
  {
    key: 'qualifications',
    to: '/masters/qualifications',
    load: () => api.qualifications().then((r) => r.qualifications.length),
  },
  {
    key: 'manuals',
    to: '/masters/manuals',
    load: () => api.trainingManuals().then((r) => r.manuals.length),
  },
  {
    key: 'users',
    to: '/masters/users',
    load: () => api.adminUsers().then((r) => r.users.length),
  },
];

type CountState = { value: number | null; error: boolean };

export function Masters() {
  const { t } = useI18n();
  const [counts, setCounts] = useState<Record<SectionKey, CountState>>(() =>
    Object.fromEntries(
      SECTIONS.map((s) => [s.key, { value: null, error: false }]),
    ) as Record<SectionKey, CountState>,
  );

  // Counts load in parallel; a failure on one master shouldn't blank
  // out the others, so each promise is settled independently.
  useEffect(() => {
    let cancelled = false;
    for (const section of SECTIONS) {
      section
        .load()
        .then((value) => {
          if (cancelled) return;
          setCounts((prev) => ({ ...prev, [section.key]: { value, error: false } }));
        })
        .catch(() => {
          if (cancelled) return;
          setCounts((prev) => ({ ...prev, [section.key]: { value: null, error: true } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t('master.title')}</h1>
        <p className="text-sm text-muted-fg">{t('master.description')}</p>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SECTIONS.map((section) => (
          <MasterCard
            key={section.key}
            sectionKey={section.key}
            to={section.to}
            count={counts[section.key]}
          />
        ))}
      </div>
    </div>
  );
}

function MasterCard({
  sectionKey,
  to,
  count,
}: {
  sectionKey: SectionKey;
  to: string;
  count: CountState;
}) {
  const { t } = useI18n();
  return (
    <Link
      to={to}
      className="group block rounded-lg border border-border bg-card hover:bg-card-hover focus:outline-none focus:ring-2 focus:ring-focus p-4 min-h-[112px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="font-semibold text-fg">{t(`master.tab.${sectionKey}`)}</h2>
          <p className="text-xs text-muted-fg">
            {t(`master.${sectionKey}.description`)}
          </p>
        </div>
        <CountBadge count={count} />
      </div>
      <div className="mt-3 text-sm text-primary group-hover:underline">
        {t('master.manage')} ›
      </div>
    </Link>
  );
}

function CountBadge({ count }: { count: CountState }) {
  const { t } = useI18n();
  if (count.error) {
    return (
      <span
        className="text-xs rounded-full bg-muted text-muted-fg px-2 py-0.5"
        title={t('master.count_error')}
      >
        —
      </span>
    );
  }
  if (count.value === null) {
    return (
      <span className="text-xs rounded-full bg-muted text-muted-fg px-2 py-0.5">
        …
      </span>
    );
  }
  return (
    <span
      className="text-xs rounded-full bg-accent text-primary px-2 py-0.5 font-medium tabular-nums"
      aria-label={t('master.count_label', { count: count.value })}
    >
      {count.value}
    </span>
  );
}
