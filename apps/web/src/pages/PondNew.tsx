// Jal Vriddhi pond creation form (§3.10). VC-and-above with
// `pond.write` capture farmer details, GPS coordinates, and the
// signed agreement scan. Re-uploads of the agreement create new
// rows in `pond_agreement_version` — handled by /ponds/:id once the
// pond exists.
//
// Shape mirrors the /capture page: village picker (auto-collapsed
// for single-village VCs), then the form fields in a card. The
// agreement upload is a two-phase flow: pick file → click Save →
// uploadAgreement() stages bytes in R2 → createPond() commits the
// row + version 1 in one transaction.

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  api,
  isIndianPhone,
  POND_STATUSES,
  type PondStatus,
  type Village,
} from '../api';
import {
  AGREEMENT_MIMES,
  AGREEMENT_MAX_BYTES,
  uploadAgreement,
} from '../lib/agreement';
import { useI18n } from '../i18n';

const FIELD =
  'mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus';

const GEO_TIMEOUT_MS = 10_000;

export function PondNew() {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [villages, setVillages] = useState<Village[] | null>(null);
  const [villageId, setVillageId] = useState<number | null>(null);

  const [farmerName, setFarmerName] = useState('');
  const [farmerPhone, setFarmerPhone] = useState('');
  const [plotIdentifier, setPlotIdentifier] = useState('');

  const [latitude, setLatitude] = useState<string>('');
  const [longitude, setLongitude] = useState<string>('');
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [status, setStatus] = useState<PondStatus>('planned');
  const [notes, setNotes] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [agreementNote, setAgreementNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.villages().then((r) => {
      setVillages(r.villages);
      if (r.villages.length > 0) setVillageId(r.villages[0]!.id);
    }).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  function captureGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError(t('pond.form.gps.unsupported'));
      return;
    }
    setGpsBusy(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Show 6 decimal places ≈ 0.1m precision — enough for a
        // pond, less noise than the raw double the API exposes.
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
        setGpsBusy(false);
      },
      (geoErr) => {
        setGpsBusy(false);
        setGpsError(geoErr.message || t('pond.form.gps.failed'));
      },
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 },
    );
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    if (f.size > AGREEMENT_MAX_BYTES) {
      setError(t('pond.form.file.too_big'));
      return;
    }
    setError(null);
    setFile(f);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (villageId === null) {
      setError(t('pond.form.error.village'));
      return;
    }
    if (!farmerName.trim()) {
      setError(t('pond.form.error.farmer_name'));
      return;
    }
    if (farmerPhone.trim() && !isIndianPhone(farmerPhone.trim())) {
      setError(t('pond.form.error.phone'));
      return;
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError(t('pond.form.error.gps'));
      return;
    }
    if (!file) {
      setError(t('pond.form.error.file'));
      return;
    }

    setSubmitting(true);
    try {
      const staged = await uploadAgreement({
        file,
        villageId,
        notes: agreementNote.trim() || null,
      });
      const created = await api.createPond({
        farmer: {
          village_id: villageId,
          full_name: farmerName.trim(),
          phone: farmerPhone.trim() || null,
          plot_identifier: plotIdentifier.trim() || null,
        },
        pond: {
          latitude: lat,
          longitude: lng,
          status,
          notes: notes.trim() || null,
        },
        agreement: staged,
      });
      navigate(`/ponds/${created.pond.pond.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pond.form.error.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  if (villages === null) {
    return <p className="text-muted-fg">{t('common.loading')}</p>;
  }
  if (villages.length === 0) {
    return <p className="text-muted-fg">{t('pond.empty_scope')}</p>;
  }
  const singleVillage = villages.length === 1;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('pond.new.title')}</h1>
        <p className="text-sm text-muted-fg mt-1">{t('pond.new.subtitle')}</p>
      </header>

      <form
        onSubmit={onSubmit}
        className="bg-card border border-border rounded p-4 space-y-5"
      >
        <fieldset className="space-y-3">
          <legend className="text-xs text-muted-fg uppercase tracking-wide">
            {t('pond.form.section.village')}
          </legend>
          {singleVillage ? (
            <div className="inline-flex items-center gap-2 bg-card-hover border border-border rounded px-3 py-1.5 text-sm">
              <span aria-hidden="true">📍</span>
              <span className="font-medium">{villages[0]?.name}</span>
            </div>
          ) : (
            <label className="block">
              <span className="text-sm">{t('pond.form.village')}</span>
              <select
                className={FIELD}
                value={villageId ?? ''}
                onChange={(e) => setVillageId(Number(e.target.value))}
              >
                {villages.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs text-muted-fg uppercase tracking-wide">
            {t('pond.form.section.farmer')}
          </legend>
          <label className="block">
            <span className="text-sm">{t('pond.form.farmer_name')}</span>
            <input
              className={FIELD}
              value={farmerName}
              onChange={(e) => setFarmerName(e.target.value)}
              required
              maxLength={120}
              autoComplete="off"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm">{t('pond.form.farmer_phone')}</span>
              <input
                className={FIELD}
                type="tel"
                value={farmerPhone}
                onChange={(e) => setFarmerPhone(e.target.value)}
                placeholder="+91XXXXXXXXXX"
                inputMode="tel"
                maxLength={14}
              />
            </label>
            <label className="block">
              <span className="text-sm">{t('pond.form.plot_identifier')}</span>
              <input
                className={FIELD}
                value={plotIdentifier}
                onChange={(e) => setPlotIdentifier(e.target.value)}
                placeholder={t('pond.form.plot_placeholder')}
                maxLength={120}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs text-muted-fg uppercase tracking-wide">
            {t('pond.form.section.location')}
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm">{t('pond.form.latitude')}</span>
              <input
                className={FIELD}
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                inputMode="decimal"
                placeholder="12.971599"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm">{t('pond.form.longitude')}</span>
              <input
                className={FIELD}
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                inputMode="decimal"
                placeholder="77.594566"
                required
              />
            </label>
          </div>
          <button
            type="button"
            onClick={captureGps}
            disabled={gpsBusy}
            className="bg-card hover:bg-card-hover text-fg border border-border rounded px-3 py-1.5 text-sm min-h-[44px] disabled:opacity-60"
          >
            {gpsBusy ? t('pond.form.gps.capturing') : t('pond.form.gps.use_my_location')}
          </button>
          {gpsError && <p className="text-sm text-danger">{gpsError}</p>}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs text-muted-fg uppercase tracking-wide">
            {t('pond.form.section.pond')}
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm">{t('pond.form.status')}</span>
              <select
                className={FIELD}
                value={status}
                onChange={(e) => setStatus(e.target.value as PondStatus)}
              >
                {POND_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`pond.status.${s}` as const)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-sm">{t('pond.form.notes')}</span>
            <textarea
              className={FIELD}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </label>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs text-muted-fg uppercase tracking-wide">
            {t('pond.form.section.agreement')}
          </legend>
          <p className="text-sm text-muted-fg">
            {t('pond.form.agreement.hint')}
          </p>
          <input
            type="file"
            accept={AGREEMENT_MIMES.join(',')}
            onChange={pickFile}
            className="block text-sm"
          />
          {file && (
            <div className="text-sm text-muted-fg">
              {file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MiB
            </div>
          )}
          <label className="block">
            <span className="text-sm">{t('pond.form.agreement_note')}</span>
            <input
              className={FIELD}
              value={agreementNote}
              onChange={(e) => setAgreementNote(e.target.value)}
              placeholder={t('pond.form.agreement_note_placeholder')}
              maxLength={200}
            />
          </label>
        </fieldset>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-4 py-2 text-sm min-h-[44px]"
          >
            {submitting ? t('common.saving') : t('pond.form.action.save')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/ponds')}
            disabled={submitting}
            className="bg-card hover:bg-card-hover text-fg border border-border rounded px-4 py-2 text-sm min-h-[44px]"
          >
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
