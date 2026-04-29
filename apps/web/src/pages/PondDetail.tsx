// Pond detail + agreement-history view (§3.10). Renders the
// full version list with download links and, for `pond.write`
// roles, a re-upload affordance that appends a new
// pond_agreement_version row.

import { useEffect, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, can, type PondDetail as PondDetailWire } from '../api';
import {
  AGREEMENT_MIMES,
  AGREEMENT_MAX_BYTES,
  uploadAgreement,
} from '../lib/agreement';
import { OfflineUnavailable } from '../components/OfflineUnavailable';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { absoluteTime } from '../lib/date';
import { useSyncState } from '../lib/sync-state';

const FIELD =
  'mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus';

export function PondDetail() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { network } = useSyncState();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const pondId = Number(id);

  const [data, setData] = useState<PondDetailWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reupload, setReupload] = useState<{ file: File; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pondId) return;
    api.pond(pondId)
      .then((r) => setData(r.pond))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [pondId]);

  const canWrite = can(user, 'pond.write');

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    if (f.size > AGREEMENT_MAX_BYTES) {
      setError(t('pond.form.file.too_big'));
      return;
    }
    setError(null);
    setReupload({ file: f, note: '' });
  }

  async function submitReupload() {
    if (!reupload || !data) return;
    setBusy(true);
    setError(null);
    try {
      const staged = await uploadAgreement({
        file: reupload.file,
        villageId: data.pond.village_id,
        notes: reupload.note.trim() || null,
      });
      const updated = await api.appendAgreement(data.pond.id, staged);
      setData(updated.pond);
      setReupload(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pond.form.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  // §3.10 pond detail is `online-only` (D25). Match L4.0f Home /
  // Dashboard pattern when the load fails offline.
  const browserOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false;
  const isOffline = network === 'offline' || browserOffline;
  if ((error || !data) && isOffline) return <OfflineUnavailable />;
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted-fg">{t('common.loading')}</p>;

  const { pond, farmer, agreements, village_name } = data;
  const latest = agreements[0];

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <button
          type="button"
          onClick={() => navigate('/ponds')}
          className="text-sm text-muted-fg hover:text-fg"
        >
          ‹ {t('pond.detail.back')}
        </button>
        <h1 className="text-xl font-semibold">{farmer.full_name}</h1>
        <p className="text-sm text-muted-fg">
          {village_name}
          {farmer.plot_identifier ? ` · ${farmer.plot_identifier}` : ''}
        </p>
      </header>

      <section className="bg-card border border-border rounded p-4 space-y-2">
        <h2 className="text-sm font-medium">{t('pond.detail.section.farmer')}</h2>
        <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-4">
          <Field label={t('pond.detail.farmer_name')} value={farmer.full_name} />
          <Field
            label={t('pond.detail.farmer_phone')}
            value={farmer.phone ?? '—'}
          />
          <Field
            label={t('pond.detail.plot_identifier')}
            value={farmer.plot_identifier ?? '—'}
          />
        </dl>
      </section>

      <section className="bg-card border border-border rounded p-4 space-y-2">
        <h2 className="text-sm font-medium">{t('pond.detail.section.pond')}</h2>
        <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-4">
          <Field
            label={t('pond.detail.gps')}
            value={`${pond.latitude.toFixed(6)}, ${pond.longitude.toFixed(6)}`}
          />
          <Field
            label={t('pond.detail.status')}
            value={t(`pond.status.${pond.status}` as const)}
          />
          <Field
            label={t('pond.detail.notes')}
            value={pond.notes ?? '—'}
            wide
          />
        </dl>
      </section>

      <section className="bg-card border border-border rounded p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">{t('pond.detail.section.agreements')}</h2>
          <span className="text-xs text-muted-fg">
            {t('pond.detail.versions_count', { n: agreements.length })}
          </span>
        </div>

        {latest && (
          <div className="text-xs text-muted-fg">
            {t('pond.detail.latest_label')} · v{latest.version} ·
            {' '}{absoluteTime(latest.uploaded_at, lang)}
          </div>
        )}

        {agreements.length === 0 ? (
          <p className="text-sm text-muted-fg">{t('pond.detail.no_versions')}</p>
        ) : (
          <ol className="space-y-2">
            {agreements.map((a) => (
              <li
                key={a.id}
                className="bg-card-hover/40 border border-border rounded p-3 text-sm"
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div className="font-medium">v{a.version}</div>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary text-xs hover:underline"
                  >
                    {t('pond.detail.download')}
                  </a>
                </div>
                <div className="text-xs text-muted-fg mt-1">
                  {a.original_filename ?? t('pond.detail.no_filename')} ·
                  {' '}{(a.bytes / (1024 * 1024)).toFixed(2)} MiB ·
                  {' '}{absoluteTime(a.uploaded_at, lang)}
                </div>
                {a.notes && (
                  <p className="text-xs mt-1">{a.notes}</p>
                )}
              </li>
            ))}
          </ol>
        )}

        {canWrite && (
          <div className="border-t border-border pt-3 mt-3 space-y-2">
            <h3 className="text-sm font-medium">{t('pond.detail.reupload.title')}</h3>
            <p className="text-xs text-muted-fg">
              {t('pond.detail.reupload.hint')}
            </p>
            {reupload ? (
              <div className="space-y-2">
                <div className="text-sm">
                  {reupload.file.name} ·
                  {' '}{(reupload.file.size / (1024 * 1024)).toFixed(2)} MiB
                </div>
                <label className="block">
                  <span className="text-sm">{t('pond.form.agreement_note')}</span>
                  <input
                    className={FIELD}
                    value={reupload.note}
                    onChange={(e) => setReupload({ ...reupload, note: e.target.value })}
                    placeholder={t('pond.form.agreement_note_placeholder')}
                    maxLength={200}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={submitReupload}
                    disabled={busy}
                    className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-4 py-2 text-sm min-h-[44px]"
                  >
                    {busy
                      ? t('common.saving')
                      : t('pond.detail.reupload.action.save', {
                          n: agreements.length + 1,
                        })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReupload(null)}
                    disabled={busy}
                    className="bg-card hover:bg-card-hover text-fg border border-border rounded px-4 py-2 text-sm min-h-[44px]"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <input
                type="file"
                accept={AGREEMENT_MIMES.join(',')}
                onChange={pickFile}
                className="block text-sm"
              />
            )}
          </div>
        )}
      </section>

      <Link to="/ponds" className="text-sm text-primary hover:underline">
        {t('pond.detail.back_full')}
      </Link>
    </div>
  );
}

function Field({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs uppercase tracking-wide text-muted-fg">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
