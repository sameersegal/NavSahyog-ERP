import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  AT_RISK_THRESHOLD_DAYS,
  DASHBOARD_METRICS,
  type DashboardMetric,
  type DrilldownQuery,
  type DrilldownResponse,
  type GeoLevel,
  type InsightsResponse,
  type VillageActivity,
} from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

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

export function Dashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const startingPos = user ? defaultPosition(user) : { level: 'india' as GeoLevel, id: null };
  const [metric, setMetric] = useState<DashboardMetric>('children');
  const [pos, setPos] = useState<Position>(startingPos);
  const [from, setFrom] = useState(firstOfMonthIst());
  const [to, setTo] = useState(todayIstDate());
  const [data, setData] = useState<DrilldownResponse | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const needsPeriod = metric === 'attendance' || metric === 'achievements';
  const preset = detectPreset(from, to);

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
    setMetric(m);
    setPos(startingPos);
  }

  function onRowClick(rowIndex: number) {
    if (!data || data.child_level === 'detail' || data.child_level === null) return;
    const id = data.drill_ids[rowIndex];
    if (id === null || id === undefined) return;
    setPos({ level: data.child_level, id });
  }

  function onCrumbClick(index: number) {
    if (!data) return;
    const c = data.crumbs[index];
    if (!c) return;
    setPos({ level: c.level, id: c.id });
  }

  function onPreset(key: PresetKey) {
    const next = applyPreset(key, from, to);
    setFrom(next.from);
    setTo(next.to);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('dashboard.title')}</h2>

      {insights && pos.level === startingPos.level && pos.id === startingPos.id && (
        <InsightRail insights={insights} />
      )}

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
                'rounded-full px-3 py-1 text-xs border ' +
                (preset === k
                  ? 'bg-primary text-primary-fg border-primary'
                  : 'bg-card text-fg border-border hover:bg-card-hover')
              }
            >
              {t(`dashboard.preset.${k}`)}
            </button>
          ))}
          {preset === 'custom' && (
            <div className="flex items-center gap-2 text-sm ml-1">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="bg-card text-fg border border-border rounded px-2 py-1"
              />
              <span className="text-muted-fg">–</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="bg-card text-fg border border-border rounded px-2 py-1"
              />
            </div>
          )}
        </div>
      )}

      {data && (
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {data.crumbs.map((c, i) => {
            const isLast = i === data.crumbs.length - 1;
            return (
              <span key={`${c.level}-${c.id ?? 'root'}`} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-fg">/</span>}
                {isLast ? (
                  <span className="font-medium">{c.name}</span>
                ) : (
                  <button
                    onClick={() => onCrumbClick(i)}
                    className="text-primary hover:underline"
                  >
                    {c.name}
                  </button>
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
        'rounded px-3 py-2 text-sm border ' +
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
  return (
    <div className="bg-card border border-border rounded overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border text-sm">
        <span className="text-muted-fg">
          {data.period
            ? t('dashboard.period.range', { from: data.period.from, to: data.period.to })
            : t('dashboard.current_snapshot')}
        </span>
        <a
          href={csvHref}
          download
          className="bg-card hover:bg-card-hover border border-border rounded px-3 py-1 text-xs"
        >
          {t('dashboard.csv_download')}
        </a>
      </div>
      <div className="overflow-x-auto">
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
                  {row.map((cell, i) => {
                    const display =
                      pctCols[i] && typeof cell === 'number' ? `${cell}%` : cell ?? '';
                    return (
                      <td
                        key={i}
                        className={
                          'px-4 py-2 ' +
                          (i === 0
                            ? (canDrill ? 'text-primary' : '')
                            : 'text-right tabular-nums')
                        }
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
