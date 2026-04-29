// /masters/qualifications — qualification CRUD admin page (§3.8.7, D21).

import { useCallback, useEffect, useState } from 'react';
import { api, type Qualification } from '../../api';
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

export function Qualifications() {
  const { t } = useI18n();
  const { network } = useSyncState();
  const [rows, setRows] = useState<Qualification[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Qualification | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(() => {
    api
      .qualifications()
      .then((r) => setRows(r.qualifications))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="space-y-4">
      <MasterPageHeader
        title={t('master.tab.qualifications')}
        description={t('master.qualifications.description')}
      />
      <Toolbar
        addLabel={t('master.qualifications.add')}
        showAdd={showAdd}
        onToggle={() => setShowAdd((v) => !v)}
      />
      {showAdd && (
        <QualificationForm
          onCancel={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}
      {editing && (
        <QualificationForm
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
        if ((err || rows === null) && isOffline) {
          return <OfflineUnavailable />;
        }
        return (
          <>
            {err && <div className="text-sm text-danger">{err}</div>}
            <Table
              head={[t('master.col.name'), t('master.col.description'), '']}
              rows={(rows ?? []).map((q) => ({
                key: q.id,
                cells: [q.name, q.description ?? ''],
                onEdit: () => setEditing(q),
              }))}
              loading={rows === null}
              empty={t('master.qualifications.empty')}
            />
          </>
        );
      })()}
    </div>
  );
}

function QualificationForm({
  existing,
  onCancel,
  onSaved,
}: {
  existing?: Qualification;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) {
      setError(t('master.error.required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const desc = description.trim() ? description.trim() : null;
      if (existing) {
        await api.updateQualification(existing.id, { name, description: desc });
      } else {
        await api.createQualification({ name, description: desc });
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
      <Field label={t('master.col.name')}>
        <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('master.col.description')}>
        <textarea
          className={FIELD}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <FormActions saving={saving} error={error} saved={saved} onCancel={onCancel} />
    </form>
  );
}
