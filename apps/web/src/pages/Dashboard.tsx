import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type DashboardMetric,
  type DrilldownQuery,
  type DrilldownResponse,
  type GeoLevel,
} from '../api';
import { useI18n } from '../i18n';

const METRICS: DashboardMetric[] = ['vc', 'af', 'children', 'attendance', 'achievements'];

function todayIstDate(): string {
  const istMs = Date.now() + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}
function firstOfMonthIst(): string {
  return todayIstDate().slice(0, 7) + '-01';
}

type Position = { level: GeoLevel; id: number | null };

export function Dashboard() {
  const { t } = useI18n();
  const [metric, setMetric] = useState<DashboardMetric>('children');
  const [pos, setPos] = useState<Position>({ level: 'india', id: null });
  // Period state; only sent to the server for attendance / achievements.
  const [from, setFrom] = useState(firstOfMonthIst());
  const [to, setTo] = useState(todayIstDate());
  const [data, setData] = useState<DrilldownResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const needsPeriod = metric === 'attendance' || metric === 'achievements';

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

  function onMetricChange(m: DashboardMetric) {
    setMetric(m);
    // Reset position to india so the user lands at the top of the
    // new metric's tree rather than wherever they were for the old.
    setPos({ level: 'india', id: null });
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

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('dashboard.title')}</h2>

      <div className="flex flex-wrap gap-2">
        {METRICS.map((m) => (
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
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted-fg">{t('dashboard.period.from')}</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-card text-fg border border-border rounded px-2 py-1.5"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted-fg">{t('dashboard.period.to')}</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-card text-fg border border-border rounded px-2 py-1.5"
            />
          </label>
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
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={
                        'px-4 py-2 ' +
                        (i === 0
                          ? (canDrill ? 'text-primary' : '')
                          : 'text-right')
                      }
                    >
                      {cell ?? ''}
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
