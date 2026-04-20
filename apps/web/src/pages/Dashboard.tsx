import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';

type Tile = 'children' | 'attendance';
type ClusterGroup<T> = { cluster_id: number; cluster_name: string; villages: T[] };

function groupByCluster<T extends { cluster_id: number; cluster_name: string }>(
  rows: T[],
): ClusterGroup<T>[] {
  const map = new Map<number, ClusterGroup<T>>();
  for (const r of rows) {
    let g = map.get(r.cluster_id);
    if (!g) {
      g = { cluster_id: r.cluster_id, cluster_name: r.cluster_name, villages: [] };
      map.set(r.cluster_id, g);
    }
    g.villages.push(r);
  }
  return Array.from(map.values());
}

export function Dashboard() {
  const { t } = useI18n();
  const [tile, setTile] = useState<Tile>('children');
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('dashboard.title')}</h2>
      <div className="flex gap-2">
        <TileButton active={tile === 'children'} onClick={() => setTile('children')}>
          {t('dashboard.tile.children')}
        </TileButton>
        <TileButton active={tile === 'attendance'} onClick={() => setTile('attendance')}>
          {t('dashboard.tile.attendance')}
        </TileButton>
      </div>
      {tile === 'children' ? <ChildrenTable /> : <AttendanceTable />}
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

function ChildrenTable() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.dashboardChildren>>['villages'] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboardChildren()
      .then((r) => setRows(r.villages))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  if (err) return <p className="text-danger">{err}</p>;
  if (!rows) return <p className="text-muted-fg">{t('common.loading')}</p>;
  const groups = groupByCluster(rows);
  const total = rows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded p-4 text-sm">
        <span className="text-muted-fg">{t('dashboard.total_children')} </span>
        <span className="font-semibold">{total}</span>
      </div>
      {groups.map((g) => (
        <div key={g.cluster_id} className="bg-card border border-border rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-border text-sm font-medium">
            {g.cluster_name}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-fg">
                  <th className="px-4 py-2 font-normal">{t('dashboard.col.village')}</th>
                  <th className="px-4 py-2 font-normal text-right">{t('dashboard.col.children')}</th>
                </tr>
              </thead>
              <tbody>
                {g.villages.map((v) => (
                  <tr key={v.village_id} className="border-t border-border">
                    <td className="px-4 py-2">{v.village_name}</td>
                    <td className="px-4 py-2 text-right">{v.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function AttendanceTable() {
  const { t } = useI18n();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.dashboardAttendance>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboardAttendance()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  if (err) return <p className="text-danger">{err}</p>;
  if (!data) return <p className="text-muted-fg">{t('common.loading')}</p>;
  const groups = groupByCluster(data.villages);
  const totalPresent = data.villages.reduce((s, r) => s + r.present, 0);
  const totalMarked = data.villages.reduce((s, r) => s + r.total, 0);
  const dateStr = data.date;

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded p-4 text-sm">
        <span className="text-muted-fg">
          {t('dashboard.summary_present', { date: dateStr })}{' '}
        </span>
        <span className="font-semibold">{totalPresent}</span>{' '}
        <span className="text-muted-fg">
          {t('dashboard.summary_marked', { count: totalMarked })}
        </span>
      </div>
      {groups.map((g) => (
        <div key={g.cluster_id} className="bg-card border border-border rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-border text-sm font-medium">
            {g.cluster_name}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-fg">
                  <th className="px-4 py-2 font-normal">{t('dashboard.col.village')}</th>
                  <th className="px-4 py-2 font-normal text-right">{t('dashboard.col.present')}</th>
                  <th className="px-4 py-2 font-normal text-right">{t('dashboard.col.marked')}</th>
                </tr>
              </thead>
              <tbody>
                {g.villages.map((v) => (
                  <tr key={v.village_id} className="border-t border-border">
                    <td className="px-4 py-2">{v.village_name}</td>
                    <td className="px-4 py-2 text-right">{v.present}</td>
                    <td className="px-4 py-2 text-right">
                      {v.marked ? v.total : <span className="text-muted-fg">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
