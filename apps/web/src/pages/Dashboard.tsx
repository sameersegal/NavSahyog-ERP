import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  AT_RISK_THRESHOLD_DAYS,
  DASHBOARD_METRICS,
  isDashboardMetric,
  isGeoLevel,
  type DashboardMetric,
  type DrilldownQuery,
  type DrilldownResponse,
  type GeoLevel,
  type GeoSearchHit,
  type InsightsResponse,
  type VillageActivity,
} from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { ScopePicker } from '../components/ScopePicker';

// Where the user lands when they first open the dashboard (or when
// they switch metrics). Super admins and anyone without a scope
// start at India; everyone else starts at their scope floor, which
// is the only meaningful root for them. Matches the trimmed
// breadcrumb the server returns for non-global users.
type Position = { level: GeoLevel; id: number | null };
function defaultPosition(user: {
  scope_level: string;
  scope_id: number | null;
}): Position {
  if (user.scope_level === 'global') return { level: 'india', id: null };
  return { level: user.scope_level as GeoLevel, id: user.scope_id };
}

function todayIstDate(): string {
  const istMs = Date.now() + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}
function firstOfMonthIst(): string {
  return todayIstDate().slice(0, 7) + '-01';
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function firstOfPrevMonthIst(): string {
  const [y, m] = todayIstDate().slice(0, 7).split('-').map(Number) as [number, number];
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return `${prev}-01`;
}
function lastOfPrevMonthIst(): string {
  return addDays(firstOfMonthIst(), -1);
}

// Period presets. Each returns a {from, to} pair the user would
// otherwise have to construct by hand. "Custom" keeps whatever's in
// the inputs; it's the escape hatch for date-range analysis.
type PresetKey = 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom';

function applyPreset(key: PresetKey, from: string, to: string): { from: string; to: string } {
  const today = todayIstDate();
  switch (key) {
    case 'today':      return { from: today, to: today };
    case 'this_week':  return { from: addDays(today, -6), to: today };
    case 'this_month': return { from: firstOfMonthIst(), to: today };
    case 'last_month': return { from: firstOfPrevMonthIst(), to: lastOfPrevMonthIst() };
    case 'custom':     return { from, to };
  }
}

function detectPreset(from: string, to: string): PresetKey {
  const today = todayIstDate();
  if (from === today && to === today) return 'today';
  if (from === addDays(today, -6) && to === today) return 'this_week';
  if (from === firstOfMonthIst() && to === today) return 'this_month';
  if (from === firstOfPrevMonthIst() && to === lastOfPrevMonthIst()) return 'last_month';
  return 'custom';
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// URL → state. `level`/`id` parse together; unrecognised combinations
// fall back to the user's scope floor. Bad `id` for a valid level
// still falls back — we'd rather show the user's own scope than a
// silent "india" for a cluster admin who followed a broken link.
function readStateFromUrl(
  params: URLSearchParams,
  fallbackPos: Position,
): { metric: DashboardMetric; pos: Position; from: string; to: string } {
  const rawMetric = params.get('metric');
  const metric: DashboardMetric = isDashboardMetric(rawMetric) ? rawMetric : 'children';

  const rawLevel = params.get('level');
  const rawId = params.get('id');
  let pos: Position = fallbackPos;
  if (isGeoLevel(rawLevel)) {
    if (rawLevel === 'india') {
      pos = { level: 'india', id: null };
    } else {
      const n = rawId === null ? NaN : Number(rawId);
      if (Number.isInteger(n) && n > 0) {
        pos = { level: rawLevel, id: n };
      }
    }
  }

  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const from = rawFrom && ISO_DATE_RE.test(rawFrom) ? rawFrom : firstOfMonthIst();
  const to = rawTo && ISO_DATE_RE.test(rawTo) ? rawTo : todayIstDate();

  return { metric, pos, from, to };
}

export function Dashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const fallbackPos: Position = user
    ? defaultPosition(user)
    : { level: 'india', id: null };

  // URL is the source of truth for everything the server call
  // consumes. Re-deriving on every render is cheap (small param set)
  // and means refresh / tab-switch restores state without extra
  // plumbing.
  const { metric, pos, from, to } = readStateFromUrl(searchParams, fallbackPos);
  const needsPeriod = metric === 'attendance' || metric === 'achievements';
  const preset = detectPreset(from, to);

  // Visual-only: when from === to we render one input + "Single day"
  // label. A range with identical endpoints is still a valid range,
  // so the toggle is about presentation, not data.
  const [rangeMode, setRangeMode] = useState<'range' | 'single'>(
    from === to ? 'single' : 'range',
  );

  const [data, setData] = useState<DrilldownResponse | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const updateUrl = useCallback(
    (patch: {
      metric?: DashboardMetric;
      level?: GeoLevel;
      id?: number | null;
      from?: string;
      to?: string;
    }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (patch.metric !== undefined) next.set('metric', patch.metric);
          if (patch.level !== undefined) next.set('level', patch.level);
          if (patch.id !== undefined) {
            if (patch.id === null) next.delete('id');
            else next.set('id', String(patch.id));
          }
          if (patch.from !== undefined) next.set('from', patch.from);
          if (patch.to !== undefined) next.set('to', patch.to);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const query = useMemo<DrilldownQuery>(
    () => ({
      metric,
      level: pos.level,
      id: pos.id,
      ...(needsPeriod ? { from, to } : {}),
    }),
    [metric, pos.level, pos.id, from, to, needsPeriod],
  );

  const reload = useCallback(() => {
    setLoading(true);
    setErr(null);
    api
      .dashboardDrilldown(query)
      .then((r) => setData(r))
      .catch((e) => {
        setErr(e instanceof Error ? e.message : 'failed');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Insights ride alongside the table. Same scope as the rest of
  // the app; no period filter (the insights card is always "now").
  useEffect(() => {
    let cancelled = false;
    api
      .insights()
      .then((r) => { if (!cancelled) setInsights(r); })
      .catch(() => { if (!cancelled) setInsights(null); });
    return () => { cancelled = true; };
  }, []);

  function onMetricChange(m: DashboardMetric) {
    updateUrl({ metric: m, level: fallbackPos.level, id: fallbackPos.id });
  }

  function onRowClick(rowIndex: number) {
    if (!data || data.child_level === 'detail' || data.child_level === null) return;
    const id = data.drill_ids[rowIndex];
    if (id === null || id === undefined) return;
    updateUrl({ level: data.child_level, id });
  }

  function onCrumbClick(index: number) {
    if (!data) return;
    const c = data.crumbs[index];
    if (!c) return;
    updateUrl({ level: c.level, id: c.id });
  }

  function onPreset(key: PresetKey) {
    const next = applyPreset(key, from, to);
    updateUrl({ from: next.from, to: next.to });
    setRangeMode(next.from === next.to ? 'single' : 'range');
  }

  function onFromChange(v: string) {
    if (rangeMode === 'single') {
      updateUrl({ from: v, to: v });
    } else {
      updateUrl({ from: v });
    }
  }

  function onToChange(v: string) {
    updateUrl({ to: v });
  }

  function toggleRangeMode() {
    if (rangeMode === 'single') {
      setRangeMode('range');
    } else {
      // collapse to single: keep `from`, sync `to`.
      updateUrl({ to: from });
      setRangeMode('single');
    }
  }

  function onScopePick(hit: GeoSearchHit) {
    updateUrl({ level: hit.level, id: hit.id });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('dashboard.title')}</h2>

      {insights && pos.level === fallbackPos.level && pos.id === fallbackPos.id && (
        <InsightRail insights={insights} />
      )}

      <ScopePicker onPick={onScopePick} />

      <div className="flex flex-wrap gap-2">
        {DASHBOARD_METRICS.map((m) => (
          <TileButton
            key={m}
            active={metric === m}
            onClick={() => onMetricChange(m)}
          >
            {t(`dashboard.metric.${m}`)}
          </TileButton>
        ))}
      </div>

      {needsPeriod && (
        <div className="flex flex-wrap items-center gap-2">
          {(['today', 'this_week', 'this_month', 'last_month', 'custom'] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                if (k === 'custom') return;
                onPreset(k);
              }}
              aria-pressed={preset === k}
              className={
                'rounded-full px-4 py-2 text-sm border min-h-[44px] ' +
                (preset === k
                  ? 'bg-primary text-primary-fg border-primary'
                  : 'bg-card text-fg border-border hover:bg-card-hover')
              }
            >
              {t(`dashboard.preset.${k}`)}
            </button>
          ))}
          {preset === 'custom' && (
            <div className="w-full sm:ml-1 sm:w-auto flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 text-sm text-fg select-none min-h-[44px]">
                <input
                  type="checkbox"
                  checked={rangeMode === 'single'}
                  onChange={toggleRangeMode}
                  className="h-5 w-5 accent-primary"
                />
                {t('dashboard.single_day')}
              </label>
              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
                <input
                  type="date"
                  aria-label={t('dashboard.date.from')}
                  value={from}
                  onChange={(e) => onFromChange(e.target.value)}
                  className="bg-card text-fg border border-border rounded px-3 py-2 min-h-[44px] w-full sm:w-auto"
                />
                {rangeMode === 'range' && (
                  <>
                    <span className="hidden sm:inline text-muted-fg" aria-hidden="true">–</span>
                    <input
                      type="date"
                      aria-label={t('dashboard.date.to')}
                      value={to}
                      onChange={(e) => onToChange(e.target.value)}
                      className="bg-card text-fg border border-border rounded px-3 py-2 min-h-[44px] w-full sm:w-auto"
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {data && (
        <nav className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
          {data.crumbs.map((c, i) => {
            const isLast = i === data.crumbs.length - 1;
            return (
              <span key={`${c.level}-${c.id ?? 'root'}`} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-fg">/</span>}
                {isLast ? (
                  <span className="font-medium px-1 py-2">{c.name}</span>
                ) : (
                  <button
                    onClick={() => onCrumbClick(i)}
                    className="text-primary hover:underline px-1 py-2 min-h-[44px]"
                  >
                    {c.name}
                  </button>
                )}
                {!isLast && c.level !== 'india' && c.id !== null && (
                  <SiblingJump
                    level={c.level}
                    id={c.id}
                    currentName={c.name}
                    onJump={(hit) => updateUrl({ level: hit.level, id: hit.id })}
                  />
                )}
              </span>
            );
          })}
        </nav>
      )}

      {err && <p className="text-sm text-danger">{err}</p>}
      {loading && !data && <p className="text-muted-fg">{t('common.loading')}</p>}

      {data && (
        <DrillDownTable
          data={data}
          onRowClick={onRowClick}
          csvHref={api.dashboardDrilldownCsvUrl(query)}
        />
      )}
    </div>
  );
}

function InsightRail({ insights }: { insights: InsightsResponse }) {
  const withCards =
    insights.at_risk_villages.length > 0 || insights.top_villages.length > 1;
  const starsAvailable =
    insights.stars_current_month.length > 0 ||
    insights.stars_prev_month.length > 0;
  const trendAvailable = insights.attendance_trend.some((p) => p.pct !== null);
  return (
    <div className="space-y-4">
      <KpiStrip kpis={insights.kpis} />
      {trendAvailable && (
        <AttendanceTrendInline points={insights.attendance_trend} />
      )}
      {withCards && (
        <div className="grid gap-3 md:grid-cols-2">
          {insights.at_risk_villages.length > 0 && (
            <AtRiskMini villages={insights.at_risk_villages.slice(0, 5)} />
          )}
          {insights.top_villages.length > 1 && (
            <TopMini villages={insights.top_villages.slice(0, 5)} />
          )}
        </div>
      )}
      {starsAvailable && (
        <StarsInline
          current={insights.stars_current_month}
          previous={insights.stars_prev_month}
        />
      )}
    </div>
  );
}

function KpiStrip({ kpis }: { kpis: InsightsResponse['kpis'] }) {
  const { t } = useI18n();
  return (
    <section className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
      {kpis.map((k) => {
        const isPct =
          k.label === 'attendance_week' || k.label === 'attendance_month';
        const trendColor =
          k.trend === 'up' ? 'text-primary'
          : k.trend === 'down' ? 'text-danger'
          : 'text-muted-fg';
        const arrow =
          k.trend === 'up' ? '▲'
          : k.trend === 'down' ? '▼'
          : k.trend === 'flat' ? '•' : null;
        return (
          <div key={k.label} className="bg-card border border-border rounded-lg p-3 flex flex-col gap-0.5">
            <div className="text-xs text-muted-fg uppercase tracking-wide">
              {t(`home.kpi.${k.label}`)}
            </div>
            <div className="text-xl font-semibold">
              {k.value}{isPct ? '%' : ''}
            </div>
            {k.delta !== null && arrow && (
              <div className={`text-xs ${trendColor}`}>
                {arrow} {k.delta > 0 ? '+' : ''}{k.delta}{isPct ? 'pp' : ''}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function AttendanceTrendInline({
  points,
}: {
  points: InsightsResponse['attendance_trend'];
}) {
  const { t } = useI18n();
  const max = Math.max(...points.map((p) => p.pct ?? 0), 1);
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-end gap-4">
      <div className="min-w-[140px]">
        <h3 className="text-sm font-semibold">{t('home.trend.title')}</h3>
        <p className="text-xs text-muted-fg">{t('home.trend.hint')}</p>
      </div>
      <div className="flex-1 grid grid-cols-3 gap-4">
        {points.map((p) => {
          const height = p.pct === null ? 0 : Math.max(6, Math.round((p.pct / max) * 56));
          return (
            <div key={p.month} className="flex flex-col items-center gap-1">
              <div className="h-16 flex items-end">
                {p.pct === null ? (
                  <span className="text-muted-fg text-sm">—</span>
                ) : (
                  <div
                    className="w-8 rounded-t bg-primary/70"
                    style={{ height: `${height}px` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="text-sm font-semibold">
                {p.pct === null ? '—' : `${p.pct}%`}
              </div>
              <div className="text-xs text-muted-fg">
                {formatMonthLabel(p.month)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatMonthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number) as [number, number];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[(m - 1) % 12]} ${String(y).slice(2)}`;
}

function StarsInline({
  current,
  previous,
}: {
  current: InsightsResponse['stars_current_month'];
  previous: InsightsResponse['stars_prev_month'];
}) {
  const { t } = useI18n();
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('home.stars.title')}</h3>
        <span className="text-xs text-muted-fg">{t('home.stars.hint')}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <StarsBlock label={t('home.stars.this_month')} stars={current} />
        <StarsBlock label={t('home.stars.last_month')} stars={previous} />
      </div>
    </div>
  );
}

function StarsBlock({
  label,
  stars,
}: {
  label: string;
  stars: InsightsResponse['stars_current_month'];
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-fg uppercase tracking-wide">
        {label}
      </div>
      {stars.length === 0 ? (
        <p className="text-sm text-muted-fg">{t('home.stars.empty')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {stars.slice(0, 5).map((s) => (
            <li key={s.achievement_id} className="flex items-baseline gap-2">
              <span aria-hidden="true">⭐</span>
              <span className="truncate">
                <span className="font-medium">{s.student_name}</span>
                <span className="text-muted-fg"> · {s.village_name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AtRiskMini({ villages }: { villages: VillageActivity[] }) {
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
        {villages.map((v) => (
          <li key={v.village_id} className="flex items-baseline justify-between gap-2">
            <Link to={`/village/${v.village_id}`} className="text-primary hover:underline truncate">
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

function TopMini({ villages }: { villages: VillageActivity[] }) {
  const { t } = useI18n();
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-2">
      <h3 className="text-sm font-semibold">{t('home.top.title')}</h3>
      <ul className="space-y-1 text-sm">
        {villages.map((v, i) => (
          <li key={v.village_id} className="flex items-baseline justify-between gap-2">
            <span className="flex items-baseline gap-2 min-w-0">
              <span className="text-xs text-muted-fg w-4 shrink-0">{i + 1}</span>
              <Link to={`/village/${v.village_id}`} className="text-primary hover:underline truncate">
                {v.village_name}
              </Link>
            </span>
            <span className="text-xs font-medium shrink-0">
              {v.attendance_pct_week}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TileButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded px-3 py-2 text-sm border min-h-[44px] ' +
        (active
          ? 'bg-primary text-primary-fg border-primary'
          : 'bg-card text-fg border-border hover:bg-card-hover')
      }
    >
      {children}
    </button>
  );
}

function DrillDownTable({
  data,
  onRowClick,
  csvHref,
}: {
  data: DrilldownResponse;
  onRowClick: (rowIndex: number) => void;
  csvHref: string;
}) {
  const { t } = useI18n();
  const drillable = data.child_level !== 'detail' && data.child_level !== null;
  // Columns whose header ends in "%" get rendered with a trailing
  // "%" glyph — the server already returns the numeric value but
  // the vendor parity table was headed "Attendance %" / cell "80",
  // which reads wrong. The glyph swap happens here so backend-side
  // CSV stays numeric.
  const pctCols = data.headers.map((h) => h.trim().endsWith('%'));
  const displayCell = (cell: string | number | null, col: number): string => {
    if (pctCols[col] && typeof cell === 'number') return `${cell}%`;
    return cell === null || cell === undefined ? '' : String(cell);
  };
  return (
    <div className="bg-card border border-border rounded overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border text-sm">
        <span className="text-muted-fg">
          {data.period
            ? t('dashboard.period.range', { from: data.period.from, to: data.period.to })
            : t('dashboard.current_snapshot')}
        </span>
        <a
          href={csvHref}
          download
          className="bg-card hover:bg-card-hover border border-border rounded px-3 py-2 text-sm min-h-[44px] inline-flex items-center"
        >
          {t('dashboard.csv_download')}
        </a>
      </div>

      {/* Mobile card view (below sm). Each row → one card; label +
          value lines below the headline. Screen-reader order matches
          the table columns. */}
      <ul className="sm:hidden divide-y divide-border">
        {data.rows.length === 0 && (
          <li className="px-4 py-6 text-center text-muted-fg text-sm">
            {t('dashboard.empty')}
          </li>
        )}
        {data.rows.map((row, rowIndex) => {
          const canDrill = drillable && data.drill_ids[rowIndex] !== null;
          const headline = displayCell(row[0] ?? '', 0);
          const card = (
            <>
              <div className={
                'text-base font-medium ' + (canDrill ? 'text-primary' : '')
              }>
                {headline}
              </div>
              {data.headers.length > 1 && (
                <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                  {row.slice(1).map((cell, i) => (
                    <div key={i + 1} className="contents">
                      <dt className="text-muted-fg">{data.headers[i + 1]}</dt>
                      <dd className="text-right tabular-nums">
                        {displayCell(cell, i + 1)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          );
          return (
            <li key={rowIndex}>
              {canDrill ? (
                <button
                  type="button"
                  onClick={() => onRowClick(rowIndex)}
                  className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-card-hover"
                >
                  {card}
                </button>
              ) : (
                <div className="px-4 py-3">{card}</div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Desktop / tablet table view (sm+). overflow-x-auto remains a
          fallback for very wide metric sets. */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-fg">
              {data.headers.map((h, i) => (
                <th
                  key={i}
                  className={
                    'px-4 py-2 font-normal ' + (i === 0 ? '' : 'text-right')
                  }
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr>
                <td
                  colSpan={data.headers.length}
                  className="px-4 py-4 text-center text-muted-fg"
                >
                  {t('dashboard.empty')}
                </td>
              </tr>
            )}
            {data.rows.map((row, rowIndex) => {
              const canDrill = drillable && data.drill_ids[rowIndex] !== null;
              return (
                <tr
                  key={rowIndex}
                  onClick={canDrill ? () => onRowClick(rowIndex) : undefined}
                  className={
                    'border-t border-border ' +
                    (canDrill ? 'cursor-pointer hover:bg-card-hover' : '')
                  }
                >
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={
                        'px-4 py-2 ' +
                        (i === 0
                          ? (canDrill ? 'text-primary' : '')
                          : 'text-right tabular-nums')
                      }
                    >
                      {displayCell(cell, i)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// SiblingJump — chevron next to a breadcrumb that opens a dropdown
// of scope-filtered siblings at the same level. Fetch is deferred
// to first-open so closed crumbs don't spawn N round-trips.
function SiblingJump({
  level,
  id,
  currentName,
  onJump,
}: {
  level: GeoLevel;
  id: number;
  currentName: string;
  onJump: (hit: { level: GeoLevel; id: number; name: string }) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [siblings, setSiblings] = useState<Array<{ id: number; name: string }> | null>(null);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    if (siblings !== null) return;
    setLoading(true);
    let cancelled = false;
    api
      .geoSiblings(level, id)
      .then((r) => { if (!cancelled) setSiblings(r.siblings); })
      .catch(() => { if (!cancelled) setSiblings([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, level, id, siblings]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('dashboard.siblings.open', { name: currentName })}
        aria-expanded={open}
        className="px-1.5 py-2 min-h-[44px] text-muted-fg hover:text-fg"
      >
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 w-max min-w-[9rem] max-w-[calc(100vw-2rem)] bg-card border border-border rounded shadow-lg max-h-[320px] overflow-auto"
        >
          {loading && (
            <div className="px-3 py-2 text-xs text-muted-fg">
              {t('common.loading')}
            </div>
          )}
          {!loading && siblings !== null && siblings.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-fg">
              {t('dashboard.siblings.empty')}
            </div>
          )}
          {!loading && siblings !== null && siblings.length > 0 && (
            <ul className="divide-y divide-border">
              {siblings.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onJump({ level, id: s.id, name: s.name });
                    }}
                    aria-current={s.id === id ? 'true' : undefined}
                    className={
                      'w-full text-left px-3 py-2 min-h-[44px] text-sm hover:bg-card-hover ' +
                      (s.id === id ? 'bg-card-hover font-medium' : '')
                    }
                  >
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
