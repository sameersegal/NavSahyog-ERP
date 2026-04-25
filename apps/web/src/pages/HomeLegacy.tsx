// HomeLegacy — pre-§3.6.4 root page. Preserved unmounted in this
// PR so L3 can decide whether its breadcrumb + at-risk + top-villages
// + child-compare grid (powered by /api/insights) gets folded into
// /dashboard's consolidated view or simply retired in favour of
// Field-Dashboard Home + Drill-down dashboard.
//
// No route renders this. App.tsx imports the new §3.6.4 Home at
// the same path. The /api/insights endpoint stays live until L3
// closes the consolidation decision.
//
// Original orientation comment follows.
//
// Home — the first surface anyone sees after login. What this page
// shows depends on the user's scope:
//
//   * VC with exactly one village → we skip the home grid entirely
//     and redirect to that village. Saves a wasted tap every time
//     they log in (VCs are the most frequent users, in the field,
//     one-handed).
//   * Everyone else → breadcrumb trail from India down to the
//     current drill position + KPI strip (scoped to the drill) +
//     insight cards (at-risk / top-this-week) + a grid of child
//     tiles at the next hierarchy level. Click a zone tile → see
//     states; click a state → see regions; etc. At cluster scope
//     the tiles are villages and navigate to /village/:id.
//
// Drill position is URL-backed (`?level=&id=`) so refresh /
// deep-link / back-button all preserve scope. An operator can
// share a link like "home at Karnataka zone" and it opens there.
//
// Data comes from /api/insights, scope-filtered server-side. That
// single round-trip carries crumbs + children + KPIs + sparks +
// top/at-risk cards — the home screen renders with one request.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AT_RISK_THRESHOLD_DAYS,
  api,
  isGeoLevel,
  type BreadcrumbCrumb,
  type GeoLevel,
  type HierarchyChild,
  type InsightKpi,
  type InsightsResponse,
  type VillageActivity,
} from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

export function HomeLegacy() {
  const { t, tPlural } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Parse ?level=&id= once per URL change. Bad params fail closed
  // to "no drill override" — the server will resolve to the user's
  // scope floor instead of erroring the whole page.
  const drill = useMemo(() => {
    const rawLevel = searchParams.get('level');
    const rawId = searchParams.get('id');
    if (!rawLevel) return {};
    if (!isGeoLevel(rawLevel)) return {};
    if (rawLevel === 'india') return { level: rawLevel };
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return {};
    return { level: rawLevel, id };
  }, [searchParams]);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .insights(drill)
      .then((r) => setData(r))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [drill.level, drill.id]);

  // Single-village VC shortcut — redirect before the page even
  // paints. The server would return a village-leaf view with empty
  // children, but VCs rarely want to read stats; they want to mark
  // attendance. Skipping the intermediate render saves a tap.
  const vcSingleVillage =
    user?.scope_level === 'village' ? user.scope_id : null;
  useEffect(() => {
    if (vcSingleVillage !== null) {
      navigate(`/village/${vcSingleVillage}`, { replace: true });
    }
  }, [vcSingleVillage, navigate]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted-fg">{t('common.loading')}</p>;
  if (vcSingleVillage !== null) return null;

  const childLabel =
    data.child_level && data.children.length > 0
      ? tPlural(
          `home.children.${data.child_level}`,
          data.children.length,
          { n: data.children.length },
        )
      : null;

  return (
    <div className="space-y-6">
      <Breadcrumbs crumbs={data.crumbs} />

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {t('home.heading', { scope: data.scope_label })}
        </h2>
        <p className="text-sm text-muted-fg">{t('home.subheading')}</p>
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

      {data.children.length > 0 && childLabel && (
        <CompareChildren label={childLabel} children={data.children} />
      )}

      {data.children.length === 0 && data.child_level !== null && (
        <p className="text-muted-fg">{t('home.empty')}</p>
      )}
    </div>
  );
}

// Breadcrumb trail from India down to the current drill position.
// Every crumb except the last is a link back to that level. Plain
// text chevrons between crumbs so the row reads on a phone without
// any icon font. Hidden entirely at the scope floor (no navigation
// to do) for users who can't drill further up anyway.
function Breadcrumbs({ crumbs }: { crumbs: BreadcrumbCrumb[] }) {
  if (crumbs.length < 2) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-fg"
    >
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${c.level}-${c.id ?? 'root'}`} className="flex items-baseline gap-2">
            {last ? (
              <span className="text-fg font-medium">{c.name}</span>
            ) : (
              <Link to={crumbHref(c)} className="text-primary hover:underline">
                {c.name}
              </Link>
            )}
            {!last && <span aria-hidden="true">›</span>}
          </span>
        );
      })}
    </nav>
  );
}

function crumbHref(c: BreadcrumbCrumb): string {
  if (c.level === 'india') return '/';
  return `/?level=${c.level}&id=${c.id}`;
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

// Child grid — one row per next-level node (zone / state / … /
// village). Merged compare + drill-down surface: every row carries
// the same KPI set the scope strip shows (children, attendance %,
// images, videos, achievements, activity) so two siblings can be
// compared horizontally without drilling, AND each row is a link
// that drills deeper (or, at the village leaf, goes to
// /village/:id — the detail surface).
//
// Desktop: table. Mobile (below sm): one card per row with the
// KPIs as a 2-col dl grid. Same data either way; responsive layout
// handles the reflow.
function CompareChildren({
  label,
  children,
}: {
  label: string;
  children: HierarchyChild[];
}) {
  const { t } = useI18n();
  const childLevel = children[0]?.level;
  if (!childLevel) return null;
  const levelHeading =
    childLevel === 'village'
      ? t('home.compare.col.name.village')
      : t(`home.compare.col.name.${childLevel}`);

  return (
    <section className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-border text-sm font-semibold text-muted-fg uppercase tracking-wide">
        {label}
      </div>

      {/* Mobile card view (below sm). Each card links to the same
          destination as its desktop-table row. */}
      <ul className="sm:hidden divide-y divide-border">
        {children.map((ch) => (
          <li key={`${ch.level}-${ch.id}`}>
            <ChildCard child={ch} />
          </li>
        ))}
      </ul>

      {/* Desktop / tablet table. overflow-x-auto as a fallback for
          narrow breakpoints where the full 7-column layout wraps. */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-fg">
              <th className="px-4 py-2 font-normal">{levelHeading}</th>
              <th className="px-4 py-2 font-normal text-right">
                {t('home.compare.col.children')}
              </th>
              <th className="px-4 py-2 font-normal text-right">
                {t('home.compare.col.attendance_week')}
              </th>
              <th className="px-4 py-2 font-normal text-right">
                {t('home.compare.col.images_month')}
              </th>
              <th className="px-4 py-2 font-normal text-right">
                {t('home.compare.col.videos_month')}
              </th>
              <th className="px-4 py-2 font-normal text-right">
                {t('home.compare.col.achievements_month')}
              </th>
              <th className="px-4 py-2 font-normal text-right">
                {t('home.compare.col.activity')}
              </th>
            </tr>
          </thead>
          <tbody>
            {children.map((ch) => (
              <ChildRow key={`${ch.level}-${ch.id}`} child={ch} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Tailwind classes for the activity chip. Same palette the prior
// card used, extracted so the mobile card + the desktop table row
// stay in sync.
function activityChip(
  days: number | null,
  t: (key: string, params?: Record<string, string | number>) => string,
): { cls: string; label: string } {
  if (days === null) {
    return { cls: 'bg-card-hover text-muted-fg', label: t('home.card.never') };
  }
  if (days === 0) {
    return { cls: 'bg-primary/15 text-primary', label: t('home.card.today') };
  }
  if (days < AT_RISK_THRESHOLD_DAYS) {
    return { cls: 'bg-card-hover text-fg', label: t('home.card.days_ago', { days }) };
  }
  return { cls: 'bg-danger/10 text-danger', label: t('home.card.days_ago', { days }) };
}

function childHref(child: HierarchyChild): string {
  return child.level === 'village'
    ? `/village/${child.id}`
    : `/?level=${child.level}&id=${child.id}`;
}

// Desktop row. The entire row is the click target (not just the
// name cell) — matches the drilldown table in Dashboard.tsx so the
// interaction model reads the same way.
function ChildRow({ child }: { child: HierarchyChild }) {
  const { t, tPlural } = useI18n();
  const navigate = useNavigate();
  const chip = activityChip(child.days_since_last_session, t);
  const subline =
    child.level === 'village'
      ? child.coordinator_name
        ? t('home.card.vc', { name: child.coordinator_name })
        : t('home.card.vc_unassigned')
      : tPlural('home.tile.villages', child.villages_count, {
          n: child.villages_count,
        });
  return (
    <tr
      onClick={() => navigate(childHref(child))}
      className="border-t border-border cursor-pointer hover:bg-card-hover"
    >
      <td className="px-4 py-2">
        <Link
          to={childHref(child)}
          className="font-medium text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {child.name}
        </Link>
        <div className="text-xs text-muted-fg truncate">{subline}</div>
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{child.children_count}</td>
      <td className="px-4 py-2 text-right tabular-nums">
        {child.attendance_pct_week === null ? '—' : `${child.attendance_pct_week}%`}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{child.images_this_month}</td>
      <td className="px-4 py-2 text-right tabular-nums">{child.videos_this_month}</td>
      <td className="px-4 py-2 text-right tabular-nums">{child.achievements_this_month}</td>
      <td className="px-4 py-2 text-right">
        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${chip.cls}`}>
          {chip.label}
        </span>
      </td>
    </tr>
  );
}

// Mobile card. Same data as the desktop row, stacked — the stat
// grid reads as a definition list so screen readers pick up the
// label/value pairs in order.
function ChildCard({ child }: { child: HierarchyChild }) {
  const { t, tPlural } = useI18n();
  const chip = activityChip(child.days_since_last_session, t);
  const subline =
    child.level === 'village'
      ? child.coordinator_name
        ? t('home.card.vc', { name: child.coordinator_name })
        : t('home.card.vc_unassigned')
      : tPlural('home.tile.villages', child.villages_count, {
          n: child.villages_count,
        });
  return (
    <Link
      to={childHref(child)}
      className="block px-4 py-3 min-h-[44px] hover:bg-card-hover"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-medium text-primary truncate">{child.name}</div>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${chip.cls}`}>
          {chip.label}
        </span>
      </div>
      <div className="text-xs text-muted-fg truncate">{subline}</div>
      <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-fg">{t('home.compare.col.children')}</dt>
        <dd className="text-right tabular-nums">{child.children_count}</dd>
        <dt className="text-muted-fg">{t('home.compare.col.attendance_week')}</dt>
        <dd className="text-right tabular-nums">
          {child.attendance_pct_week === null ? '—' : `${child.attendance_pct_week}%`}
        </dd>
        <dt className="text-muted-fg">{t('home.compare.col.images_month')}</dt>
        <dd className="text-right tabular-nums">{child.images_this_month}</dd>
        <dt className="text-muted-fg">{t('home.compare.col.videos_month')}</dt>
        <dd className="text-right tabular-nums">{child.videos_this_month}</dd>
        <dt className="text-muted-fg">{t('home.compare.col.achievements_month')}</dt>
        <dd className="text-right tabular-nums">{child.achievements_this_month}</dd>
      </dl>
    </Link>
  );
}
