// /masters/events — event/activity CRUD admin page (§3.8.7, D21,
// D23 kind-immutability).

import { useCallback, useEffect, useState } from 'react';
import { api, type AdminEvent } from '../../api';
import { OfflineUnavailable } from '../../components/OfflineUnavailable';
import { useI18n } from '../../i18n';
import { useSyncState } from '../../lib/sync-state';
import {
  Field,
  FIELD,
  FormActions,
  HELP,
  MasterPageHeader,
  Table,
  Toolbar,
} from './_shared';

export function Events() {
  const { t } = useI18n();
  const { network } = useSyncState();
  const [rows, setRows] = useState<AdminEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminEvent | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(() => {
    api
      .adminEvents()
      .then((r) => setRows(r.events))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="space-y-4">
      <MasterPageHeader
        title={t('master.tab.events')}
        description={t('master.events.description')}
      />
      <Toolbar
        addLabel={t('master.events.add')}
        showAdd={showAdd}
        onToggle={() => setShowAdd((v) => !v)}
      />
      {showAdd && (
        <EventForm
          onCancel={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}
      {editing && (
        <EventForm
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
              head={[
                t('master.col.name'),
                t('master.col.kind'),
                t('master.col.references'),
                '',
              ]}
              rows={(rows ?? []).map((ev) => ({
                key: ev.id,
                cells: [
                  ev.name,
                  t(`master.kind.${ev.kind}`),
                  String(ev.reference_count),
                ],
                onEdit: () => setEditing(ev),
              }))}
              loading={rows === null}
            />
          </>
        );
      })()}
    </div>
  );
}

function EventForm({
  existing,
  onCancel,
  onSaved,
}: {
  existing?: AdminEvent;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<'event' | 'activity'>(existing?.kind ?? 'activity');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Server enforces H5 immutability; we mirror it in the UI so the
  // user doesn't submit a doomed change. Locked once any media or
  // attendance row points at this event.
  const kindLocked = !!existing && existing.kind_locked === 1;

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
        await api.updateEvent(existing.id, {
          name,
          kind: kindLocked ? undefined : kind,
          description: desc,
        });
      } else {
        await api.createEvent({ name, kind, description: desc });
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
        <Field label={t('master.col.kind')}>
          <select
            className={FIELD}
            value={kind}
            disabled={kindLocked}
            onChange={(e) => setKind(e.target.value as 'event' | 'activity')}
          >
            <option value="activity">{t('master.kind.activity')}</option>
            <option value="event">{t('master.kind.event')}</option>
          </select>
          {kindLocked && (
            <p className={HELP}>{t('master.events.kind_locked')}</p>
          )}
        </Field>
      </div>
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
