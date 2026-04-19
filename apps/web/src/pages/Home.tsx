import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Village } from '../api';

export function Home() {
  const [villages, setVillages] = useState<Village[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .villages()
      .then((r) => setVillages(r.villages))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!villages) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Your villages</h2>
      {villages.length === 0 ? (
        <p className="text-slate-500">No villages in scope.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {villages.map((v) => (
            <li key={v.id}>
              <Link
                to={`/village/${v.id}`}
                className="block bg-white rounded shadow p-4 hover:bg-emerald-50"
              >
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-slate-500">
                  {v.cluster_name} · {v.code}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
