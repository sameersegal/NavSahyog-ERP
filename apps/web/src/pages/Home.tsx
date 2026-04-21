// Home — the first surface anyone sees after login. What this page
// shows depends on the user's scope:
//
//   * VC with exactly one village → we skip the home grid entirely
//     and redirect to that village. Saves a wasted tap every time
//     they log in (VCs are the most frequent users, in the field,
//     one-handed).
//   * Everyone else → KPI strip (includes Star-of-the-Month yes/no)
//     + 90-day attendance sparkline + insight cards (at-risk /
//     top-this-week / stars-of-the-month) + a village grid
//     annotated with coordinator name + activity chip.
//
// Data comes from /api/insights (scope-filtered). That single call
// replaces the old /api/villages fetch and carries everything the
// page needs — sparkline points, KPI deltas, stars, village
// activity — so the home screen renders with one round-trip.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AT_RISK_THRESHOLD_DAYS,
  api,
  type AttendanceSparkPoint,
  type InsightKpi,
  type InsightsResponse,
  type StarOfTheMonth,
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

  const starsAvailable =
    data.stars_current_month.length > 0 || data.stars_prev_month.length > 0;

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

      <KpiStrip
        kpis={data.kpis}
        somDeclared={data.som_declared_this_month}
      />

      <AttendanceSparkline points={data.attendance_90d} />

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

      {starsAvailable && (
        <StarsCard
          current={data.stars_current_month}
          previous={data.stars_prev_month}
        />
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
// (six numeric + SOM yes/no) into a single row.
function KpiStrip({
  kpis,
  somDeclared,
}: {
  kpis: InsightKpi[];
  somDeclared: boolean;
}) {
  return (
    <section className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {kpis.map((k) => (
        <KpiTile key={k.label} k={k} />
      ))}
      <SomDeclaredTile declared={somDeclared} />
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
    </div>
  );
}

// Star-of-the-Month declaration tile — a yes/no signal rather than
// a count. Ops uses this to confirm at a glance that the monthly
// recognition ritual has been run for the current calendar month.
function SomDeclaredTile({ declared }: { declared: boolean }) {
  const { t } = useI18n();
  const tone = declared ? 'text-primary' : 'text-danger';
  return (
    <div className="bg-card border border-border rounded-lg p-3 flex flex-col gap-1">
      <div className="text-xs text-muted-fg uppercase tracking-wide">
        {t('home.kpi.som_declared')}
      </div>
      <div className={`text-2xl font-semibold ${tone}`}>
        {declared ? t('home.kpi.som_declared.yes') : t('home.kpi.som_declared.no')}
      </div>
      <div className="text-xs text-muted-fg">
        {t('home.kpi.som_declared.hint')}
      </div>
    </div>
  );
}

// 90-day attendance sparkline. Renders as an SVG polyline so it
// survives sunlight theme and low-power devices. Days with no marks
// are drawn as a gap (null break) rather than a zero floor, so an
// empty day reads as "no session" not "0% attendance".
function AttendanceSparkline({ points }: { points: AttendanceSparkPoint[] }) {
  const { t } = useI18n();
  if (points.every((p) => p.pct === null)) return null;

  const W = 600;
  const H = 80;
  const padX = 4;
  const padY = 6;
  const n = points.length;
  // y maps 0..100 → bottom..top of the drawable area. Max is pinned
  // at 100 so attendance is comparable across sparkline renders
  // across scopes and days; a partial-scope 80% shouldn't look like
  // a "peak" just because the local max happened to be 82%.
  const xFor = (i: number) =>
    n === 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (n - 1);
  const yFor = (pct: number) => padY + ((100 - pct) * (H - 2 * padY)) / 100;

  // Build the polyline with gaps. An 'M' starts a new subpath after
  // any run of null days so the line never falsely bridges missing
  // sessions.
  let d = '';
  let penDown = false;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    if (p.pct === null) {
      penDown = false;
      continue;
    }
    const cmd = penDown ? 'L' : 'M';
    d += `${cmd}${xFor(i).toFixed(1)},${yFor(p.pct).toFixed(1)} `;
    penDown = true;
  }

  // Dots on days with marks — visually anchors the line and helps on
  // scopes that run infrequently (one session every few days).
  const dots = points
    .map((p, i) => (p.pct === null ? null : { i, pct: p.pct }))
    .filter((x): x is { i: number; pct: number } => x !== null);

  const observed = points
    .map((p) => p.pct)
    .filter((v): v is number => v !== null);
  const latest = observed[observed.length - 1];
  const avg = observed.length === 0
    ? null
    : Math.round(observed.reduce((a, b) => a + b, 0) / observed.length);

  const startLabel = formatDayMonth(points[0]!.date);
  const endLabel = formatDayMonth(points[n - 1]!.date);

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('home.spark.title')}</h3>
        <span className="text-xs text-muted-fg">
          {avg === null
            ? t('home.spark.hint')
            : t('home.spark.hint_avg', { avg })}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t('home.spark.aria', { n })}
        preserveAspectRatio="none"
        className="w-full h-20"
      >
        {/* 50% reference line — a visual guide without a full axis. */}
        <line
          x1={padX}
          x2={W - padX}
          y1={yFor(50)}
          y2={yFor(50)}
          className="stroke-border"
          strokeDasharray="3 4"
          strokeWidth={1}
        />
        <path
          d={d.trim()}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {dots.map(({ i, pct }) => (
          <circle
            key={i}
            cx={xFor(i)}
            cy={yFor(pct)}
            r={1.8}
            className="fill-primary"
          />
        ))}
      </svg>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-fg">
        <span>{startLabel}</span>
        <span>
          {latest !== undefined && (
            <span className="text-fg font-medium">{latest}%</span>
          )}
          {latest !== undefined ? ' · ' : ''}
          {t('home.spark.today')}
        </span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

// Short day-month label for the sparkline axis endpoints. Parses the
// ISO date locally (no Intl timezone pitfalls) so "21 Apr" renders
// identically regardless of client locale.
function formatDayMonth(iso: string): string {
  const [, m, d] = iso.split('-').map(Number) as [number, number, number];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${names[(m - 1) % 12]}`;
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

// Stars of the Month — two-column card (current vs previous). Each
// column lists star students with their village. Empty columns
// render an em-dash so the card still reads when one of the months
// has no data yet (happens early in a fresh month).
function StarsCard({
  current,
  previous,
}: {
  current: StarOfTheMonth[];
  previous: StarOfTheMonth[];
}) {
  const { t } = useI18n();
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('home.stars.title')}</h3>
        <span className="text-xs text-muted-fg">{t('home.stars.hint')}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <StarsColumn label={t('home.stars.this_month')} stars={current} />
        <StarsColumn label={t('home.stars.last_month')} stars={previous} />
      </div>
    </div>
  );
}

function StarsColumn({ label, stars }: { label: string; stars: StarOfTheMonth[] }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-fg uppercase tracking-wide">
        {label}
      </div>
      {stars.length === 0 ? (
        <p className="text-sm text-muted-fg">{t('home.stars.empty')}</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {stars.map((s) => (
            <li key={s.achievement_id} className="flex items-baseline gap-2">
              <span aria-hidden="true">⭐</span>
              <div className="min-w-0">
                <div className="truncate">
                  <span className="font-medium">{s.student_name}</span>
                  <span className="text-muted-fg"> · {s.village_name}</span>
                </div>
                <div className="text-xs text-muted-fg truncate">{s.description}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
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
