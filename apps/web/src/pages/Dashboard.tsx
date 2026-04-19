import { useEffect, useState } from 'react';
import { api } from '../api';

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
  const [tile, setTile] = useState<Tile>('children');
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Drill-down dashboard</h2>
      <div className="flex gap-2">
        <TileButton active={tile === 'children'} onClick={() => setTile('children')}>
          Children
        </TileButton>
        <TileButton active={tile === 'attendance'} onClick={() => setTile('attendance')}>
          Attendance (today)
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
      className={`rounded px-3 py-2 text-sm ${
        active
          ? 'bg-emerald-700 text-white'
          : 'bg-white text-slate-700 shadow hover:bg-emerald-50'
      }`}
    >
      {children}
    </button>
  );
}

function ChildrenTable() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.dashboardChildren>>['villages'] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboardChildren()
      .then((r) => setRows(r.villages))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  if (err) return <p className="text-rose-600">{err}</p>;
  if (!rows) return <p className="text-slate-500">Loading…</p>;
  const groups = groupByCluster(rows);
  const total = rows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded shadow p-4 text-sm">
        <span className="text-slate-500">Total children in scope: </span>
        <span className="font-semibold">{total}</span>
      </div>
      {groups.map((g) => (
        <div key={g.cluster_id} className="bg-white rounded shadow">
          <div className="px-4 py-2 border-b text-sm font-medium text-slate-700">
            {g.cluster_name}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="px-4 py-2 font-normal">Village</th>
                <th className="px-4 py-2 font-normal text-right">Children</th>
              </tr>
            </thead>
            <tbody>
              {g.villages.map((v) => (
                <tr key={v.village_id} className="border-t">
                  <td className="px-4 py-2">{v.village_name}</td>
                  <td className="px-4 py-2 text-right">{v.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function AttendanceTable() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.dashboardAttendance>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboardAttendance()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  if (err) return <p className="text-rose-600">{err}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;
  const groups = groupByCluster(data.villages);
  const totalPresent = data.villages.reduce((s, r) => s + r.present, 0);
  const totalMarked = data.villages.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded shadow p-4 text-sm">
        <span className="text-slate-500">
          {new Date(data.date * 1000).toISOString().slice(0, 10)} — present:{' '}
        </span>
        <span className="font-semibold">{totalPresent}</span>
        <span className="text-slate-500"> / {totalMarked} marked</span>
      </div>
      {groups.map((g) => (
        <div key={g.cluster_id} className="bg-white rounded shadow">
          <div className="px-4 py-2 border-b text-sm font-medium text-slate-700">
            {g.cluster_name}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="px-4 py-2 font-normal">Village</th>
                <th className="px-4 py-2 font-normal text-right">Present</th>
                <th className="px-4 py-2 font-normal text-right">Marked</th>
              </tr>
            </thead>
            <tbody>
              {g.villages.map((v) => (
                <tr key={v.village_id} className="border-t">
                  <td className="px-4 py-2">{v.village_name}</td>
                  <td className="px-4 py-2 text-right">{v.present}</td>
                  <td className="px-4 py-2 text-right">
                    {v.marked ? v.total : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
