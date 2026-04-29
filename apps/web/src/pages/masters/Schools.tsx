// /masters/schools — school CRUD admin page (§3.8.7, D21).

import { useCallback, useEffect, useState } from 'react';
import { api, type AdminSchool, type GeoLevels } from '../../api';
import { OfflineUnavailable } from '../../components/OfflineUnavailable';
import { useI18n } from '../../i18n';
import { useSyncState } from '../../lib/sync-state';
import {
  Field,
  FIELD,
  FormActions,
  MasterPageHeader,
  Table,
  Toolbar,
} from './_shared';

export function Schools() {
  const { t } = useI18n();
  const { network } = useSyncState();
  const [geo, setGeo] = useState<GeoLevels | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminSchool[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminSchool | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    api
      .geoAll()
      .then((r) => setGeo(r.levels))
      .catch((e) => setGeoErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  const reload = useCallback(() => {
    api
      .adminSchools()
      .then((r) => setRows(r.schools))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="space-y-4">
      <MasterPageHeader
        title={t('master.tab.schools')}
        description={t('master.schools.description')}
      />
      <Toolbar
        addLabel={t('master.schools.add')}
        showAdd={showAdd}
        onToggle={() => setShowAdd((v) => !v)}
      />
      {showAdd && (
        <SchoolForm
          geo={geo}
          onCancel={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}
      {editing && (
        <SchoolForm
          geo={geo}
          existing={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {(() => {
        // §3.8.7 master CRUD reads are `online-only`. Match L4.0f
        // Home / Dashboard pattern when offline. Header + Toolbar +
        // forms stay visible above; only the data table is replaced.
        const browserOffline =
          typeof navigator !== 'undefined' && navigator.onLine === false;
        const isOffline = network === 'offline' || browserOffline;
        if ((err || geoErr || rows === null) && isOffline) {
          return <OfflineUnavailable />;
        }
        return (
          <>
            {geoErr && <div className="text-sm text-danger">{geoErr}</div>}
            {err && <div className="text-sm text-danger">{err}</div>}
            <Table
              head={[t('master.col.name'), t('master.col.village'), '']}
              rows={(rows ?? []).map((s) => ({
                key: s.id,
                cells: [s.name, s.village_name],
                onEdit: () => setEditing(s),
              }))}
              loading={rows === null}
            />
          </>
        );
      })()}
    </div>
  );
}

function SchoolForm({
  geo,
  existing,
  onCancel,
  onSaved,
}: {
  geo: GeoLevels | null;
  existing?: AdminSchool;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? '');
  const [villageId, setVillageId] = useState<number | ''>(existing?.village_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !villageId) {
      setError(t('master.error.required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (existing) {
        await api.updateSchool(existing.id, { name, village_id: Number(villageId) });
      } else {
        await api.createSchool({ name, village_id: Number(villageId) });
      }
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="border border-border rounded-lg p-4 bg-card space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t('master.col.name')}>
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('master.col.village')}>
          <select
            className={FIELD}
            value={villageId}
            onChange={(e) => setVillageId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">{t('master.pick.village')}</option>
            {(geo?.village ?? []).map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <FormActions saving={saving} error={error} saved={saved} onCancel={onCancel} />
    </form>
  );
}
