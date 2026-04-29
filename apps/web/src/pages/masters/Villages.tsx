// /masters/villages — village CRUD admin page (§3.8.7, D21).
// Capability gate is enforced by the App.tsx route, so we don't
// re-check here.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type AdminVillage, type GeoLevels } from '../../api';
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

export function Villages() {
  const { t } = useI18n();
  const { network } = useSyncState();
  const [geo, setGeo] = useState<GeoLevels | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminVillage[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminVillage | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    api
      .geoAll()
      .then((r) => setGeo(r.levels))
      .catch((e) => setGeoErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  const reload = useCallback(() => {
    api
      .adminVillages()
      .then((r) => setRows(r.villages))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(reload, [reload]);

  const clusterName = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of geo?.cluster ?? []) map.set(c.id, c.name);
    return (id: number) => map.get(id) ?? `cluster ${id}`;
  }, [geo]);

  return (
    <div className="space-y-4">
      <MasterPageHeader
        title={t('master.tab.villages')}
        description={t('master.villages.description')}
      />
      <Toolbar
        addLabel={t('master.villages.add')}
        showAdd={showAdd}
        onToggle={() => setShowAdd((v) => !v)}
      />
      {showAdd && (
        <VillageForm
          geo={geo}
          onCancel={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}
      {editing && (
        <VillageForm
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
        // Home / Dashboard pattern when offline.
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
              head={[t('master.col.name'), t('master.col.code'), t('master.col.cluster'), '']}
              rows={(rows ?? []).map((v) => ({
                key: v.id,
                cells: [v.name, v.code, clusterName(v.cluster_id)],
                onEdit: () => setEditing(v),
              }))}
              loading={rows === null}
            />
          </>
        );
      })()}
    </div>
  );
}

function VillageForm({
  geo,
  existing,
  onCancel,
  onSaved,
}: {
  geo: GeoLevels | null;
  existing?: AdminVillage;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [clusterId, setClusterId] = useState<number | ''>(
    existing?.cluster_id ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !code || !clusterId) {
      setError(t('master.error.required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (existing) {
        await api.updateVillage(existing.id, {
          name,
          code,
          cluster_id: Number(clusterId),
        });
      } else {
        await api.createVillage({ name, code, cluster_id: Number(clusterId) });
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
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={t('master.col.name')}>
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('master.col.code')}>
          <input className={FIELD} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label={t('master.col.cluster')}>
          <select
            className={FIELD}
            value={clusterId}
            onChange={(e) => setClusterId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">{t('master.pick.cluster')}</option>
            {(geo?.cluster ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <FormActions saving={saving} error={error} saved={saved} onCancel={onCancel} />
    </form>
  );
}
