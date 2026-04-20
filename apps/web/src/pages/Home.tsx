import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Village } from '../api';
import { useI18n } from '../i18n';

export function Home() {
  const { t } = useI18n();
  const [villages, setVillages] = useState<Village[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .villages()
      .then((r) => setVillages(r.villages))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  if (error) return <p className="text-danger">{error}</p>;
  if (!villages) return <p className="text-muted-fg">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('home.your_villages')}</h2>
      {villages.length === 0 ? (
        <p className="text-muted-fg">{t('home.empty')}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {villages.map((v) => (
            <li key={v.id}>
              <Link
                to={`/village/${v.id}`}
                className="block bg-card hover:bg-card-hover border border-border rounded-lg p-4 transition-colors"
              >
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-muted-fg">
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
