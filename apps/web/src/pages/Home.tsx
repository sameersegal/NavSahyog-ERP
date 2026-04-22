// Home — the first surface anyone sees after login. What this page
// shows depends on the user's scope:
//
//   * VC with exactly one village → we skip the home grid entirely
//     and redirect to that village. Saves a wasted tap every time
//     they log in (VCs are the most frequent users, in the field,
//     one-handed).
//   * Everyone else → KPI strip (each numeric tile carries its own
//     inline 12-week sparkline; the SoM tile shows % declared) +
//     insight cards (at-risk / top-this-week) + a village grid
//     annotated with coordinator name + activity chip.
//
// Data comes from /api/insights (scope-filtered). That single call
// replaces the old /api/villages fetch and carries everything the
// page needs — per-KPI sparks, deltas, village activity — so the
// home screen renders with one round-trip.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AT_RISK_THRESHOLD_DAYS,
  api,
  type InsightKpi,
  type InsightsResponse,
  type VillageActivity,
} from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

export function Home() {
  const { t, tPlural } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .insights()
      .then((r) => setData(r))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  // Single-village fast path — redirect as soon as we know. This
  // usually lands with the insights response; the grid flashes for
  // one frame at most.
  const autoRedirectVillage = useMemo(() => {
    if (!user || user.scope_level !== 'village') return null;
    if (!data || data.all_villages.length !== 1) return null;
    return data.all_villages[0]!.village_id;
  }, [user, data]);

  useEffect(() => {
    if (autoRedirectVillage !== null) {
      navigate(`/village/${autoRedirectVillage}`, { replace: true });
    }
  }, [autoRedirectVillage, navigate]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted-fg">{t('common.loading')}</p>;
  if (autoRedirectVillage !== null) {
    // Render nothing while the redirect is resolving — the grid
    // would flash on slow connections otherwise.
    return null;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {t('home.heading', { scope: data.scope_label })}
        </h2>
        <p className="text-sm text-muted-fg">
          {t('home.subheading')}
        </p>
      </header>

      <KpiStrip kpis={data.kpis} somDeclaredPct={data.som_declared_pct} />

      {(data.at_risk_villages.length > 0 || data.top_villages.length > 1) && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.at_risk_villages.length > 0 && (
            <AtRiskCard villages={data.at_risk_villages} />
          )}
          {data.top_villages.length > 1 && (
            <TopVillagesCard villages={data.top_villages} />
          )}
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-muted-fg uppercase tracking-wide">
          {tPlural('home.villages', data.all_villages.length)}
        </h3>
        {data.all_villages.length === 0 ? (
          <p className="text-muted-fg">{t('home.empty')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.all_villages.map((v) => (
              <li key={v.village_id}>
                <VillageCard v={v} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// KPI strip. On mobile the tiles stack in a single column so each
// metric reads as its own line; desktop packs the same seven tiles
// (six numeric + SOM %) into a single row.
function KpiStrip({
  kpis,
  somDeclaredPct,
}: {
  kpis: InsightKpi[];
  somDeclaredPct: number;
}) {
  return (
    <section className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {kpis.map((k) => (
        <KpiTile key={k.label} k={k} />
      ))}
      <SomDeclaredTile pct={somDeclaredPct} />
    </section>
  );
}

function KpiTile({ k }: { k: InsightKpi }) {
  const { t } = useI18n();
  const isPct =
    k.label === 'attendance_week' || k.label === 'attendance_month';
  const trendColor =
    k.trend === 'up' ? 'text-primary'
    : k.trend === 'down' ? 'text-danger'
    : 'text-muted-fg';
  const arrow = k.trend === 'up' ? '▲' : k.trend === 'down' ? '▼' : k.trend === 'flat' ? '•' : null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 flex flex-col gap-1">
      <div className="text-xs text-muted-fg uppercase tracking-wide">
        {t(`home.kpi.${k.label}`)}
      </div>
      <div className="text-2xl font-semibold">
        {k.value}
        {isPct ? '%' : ''}
      </div>
      {k.delta !== null && arrow && (
        <div className={`text-xs ${trendColor}`}>
          {arrow} {k.delta > 0 ? '+' : ''}
          {k.delta}
          {isPct ? 'pp' : ''}
          {k.hint ? ' · ' + t(`home.kpi.hint.${k.hint}`) : ''}
        </div>
      )}
      {k.spark && <TileSpark points={k.spark} isPct={isPct} />}
    </div>
  );
}

// Inline 12-week sparkline inside a KPI tile. No axis, no dots, no
// legend — the tile's big number is the headline; the spark is just
// silhouette. `isPct`=true pins the y-axis to 0–100 so attendance
// sparks compare meaningfully across scopes; count sparks (images,
// videos, achievements) autoscale to their own max so a scope with
// 2 uploads/week still reads as a shape.
function TileSpark({
  points,
  isPct,
}: {
  points: Array<number | null>;
  isPct: boolean;
}) {
  const observed = points.filter((v): v is number => v !== null);
  if (observed.length === 0) return null;

  const W = 120;
  const H = 24;
  const padX = 1;
  const padY = 2;
  const n = points.length;
  const max = isPct ? 100 : Math.max(1, ...observed);
  const xFor = (i: number) =>
    n === 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (n - 1);
  const yFor = (v: number) =>
    padY + ((max - v) * (H - 2 * padY)) / (max === 0 ? 1 : max);

  // Build the polyline with 'M' gap-breaks so null weeks draw as
  // broken segments rather than a false bridge to zero.
  let d = '';
  let penDown = false;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (p === null || p === undefined) {
      penDown = false;
      continue;
    }
    const cmd = penDown ? 'L' : 'M';
    d += `${cmd}${xFor(i).toFixed(1)},${yFor(p).toFixed(1)} `;
    penDown = true;
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-6 mt-1"
      aria-hidden="true"
    >
      <path
        d={d.trim()}
        fill="none"
        className="stroke-primary"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Star-of-the-Month declaration tile — share of in-scope villages
// that have declared one this month. Tone flips to primary only at
// 100% so partial coverage still reads as "work to do"; 0% reads
// as danger so ops sees the miss at a glance.
function SomDeclaredTile({ pct }: { pct: number }) {
  const { t } = useI18n();
  const tone =
    pct >= 100 ? 'text-primary'
    : pct === 0 ? 'text-danger'
    : 'text-fg';
  return (
    <div className="bg-card border border-border rounded-lg p-3 flex flex-col gap-1">
      <div className="text-xs text-muted-fg uppercase tracking-wide">
        {t('home.kpi.som_declared')}
      </div>
      <div className={`text-2xl font-semibold ${tone}`}>{pct}%</div>
      <div className="text-xs text-muted-fg">
        {t('home.kpi.som_declared.hint')}
      </div>
    </div>
  );
}

function AtRiskCard({ villages }: { villages: VillageActivity[] }) {
  const { t } = useI18n();
  return (
    <div className="bg-card border border-danger/30 rounded-lg p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-danger">
          {t('home.at_risk.title')}
        </h3>
        <span className="text-xs text-muted-fg">
          {t('home.at_risk.threshold', { days: AT_RISK_THRESHOLD_DAYS })}
        </span>
      </div>
      <ul className="space-y-1 text-sm">
        {villages.slice(0, 5).map((v) => (
          <li key={v.village_id} className="flex items-baseline justify-between gap-2">
            <Link
              to={`/village/${v.village_id}`}
              className="text-primary hover:underline truncate"
            >
              {v.village_name}
            </Link>
            <span className="text-xs text-muted-fg shrink-0">
              {v.days_since_last_session === null
                ? t('home.at_risk.never')
                : t('home.at_risk.days', { days: v.days_since_last_session })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopVillagesCard({ villages }: { villages: VillageActivity[] }) {
  const { t } = useI18n();
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-2">
      <h3 className="text-sm font-semibold">{t('home.top.title')}</h3>
      <ul className="space-y-1 text-sm">
        {villages.map((v, i) => (
          <li key={v.village_id} className="flex items-baseline justify-between gap-2">
            <span className="flex items-baseline gap-2 min-w-0">
              <span className="text-xs text-muted-fg w-4 shrink-0">{i + 1}</span>
              <Link
                to={`/village/${v.village_id}`}
                className="text-primary hover:underline truncate"
              >
                {v.village_name}
              </Link>
            </span>
            <span className="text-xs font-medium shrink-0">
              {v.attendance_pct_week}%
              <span className="text-muted-fg">
                {' '}· {v.sessions_this_week}
                {v.sessions_this_week === 1 ? ' session' : ' sessions'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Village card — activity chip colour driven by days-since-last.
// Now also shows the coordinator name under the cluster line so
// back-office knows who to ping about a village without drilling in.
function VillageCard({ v }: { v: VillageActivity }) {
  const { t } = useI18n();
  const days = v.days_since_last_session;
  let chipClass: string;
  let chipLabel: string;
  if (days === null) {
    chipClass = 'bg-card-hover text-muted-fg';
    chipLabel = t('home.card.never');
  } else if (days === 0) {
    chipClass = 'bg-primary/15 text-primary';
    chipLabel = t('home.card.today');
  } else if (days < AT_RISK_THRESHOLD_DAYS) {
    chipClass = 'bg-card-hover text-fg';
    chipLabel = t('home.card.days_ago', { days });
  } else {
    chipClass = 'bg-danger/10 text-danger';
    chipLabel = t('home.card.days_ago', { days });
  }

  return (
    <Link
      to={`/village/${v.village_id}`}
      className="block bg-card hover:bg-card-hover border border-border rounded-lg p-4 transition-colors space-y-2"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-medium truncate">{v.village_name}</div>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${chipClass}`}>
          {chipLabel}
        </span>
      </div>
      <div className="text-xs text-muted-fg">{v.cluster_name}</div>
      <div className="text-xs text-muted-fg truncate">
        {v.coordinator_name
          ? t('home.card.vc', { name: v.coordinator_name })
          : t('home.card.vc_unassigned')}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-fg">
          {t('home.card.children', { n: v.children_count })}
        </span>
        {v.attendance_pct_week !== null && (
          <span className="text-muted-fg">
            · {t('home.card.week_attendance', { pct: v.attendance_pct_week })}
          </span>
        )}
      </div>
    </Link>
  );
}
