// /masters/manuals — training-manual CRUD admin page (§3.8.7).
// Read view lives at /training-manuals; this is the write side.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type TrainingManual } from '../../api';
import { useI18n } from '../../i18n';
import {
  Field,
  FIELD,
  FormActions,
  HELP,
  MasterPageHeader,
  Table,
  Toolbar,
} from './_shared';

export function Manuals() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<TrainingManual[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<TrainingManual | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(() => {
    api
      .trainingManuals()
      .then((r) => setRows(r.manuals))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(reload, [reload]);

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [lang],
  );

  return (
    <div className="space-y-4">
      <MasterPageHeader
        title={t('master.tab.manuals')}
        description={t('master.manuals.description')}
      />
      <Toolbar
        addLabel={t('master.manuals.add')}
        showAdd={showAdd}
        onToggle={() => setShowAdd((v) => !v)}
      />
      {showAdd && (
        <TrainingManualForm
          onCancel={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}
      {editing && (
        <TrainingManualForm
          existing={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {err && <div className="text-sm text-danger">{err}</div>}
      <Table
        head={[
          t('master.col.category'),
          t('master.col.name'),
          t('master.col.link'),
          t('master.col.updated_at'),
          '',
        ]}
        rows={(rows ?? []).map((m) => ({
          key: m.id,
          cells: [
            m.category,
            m.name,
            m.link,
            fmt.format(new Date(m.updated_at * 1000)),
          ],
          onEdit: () => setEditing(m),
        }))}
        loading={rows === null}
        empty={t('master.manuals.empty')}
      />
    </div>
  );
}

function TrainingManualForm({
  existing,
  onCancel,
  onSaved,
}: {
  existing?: TrainingManual;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [category, setCategory] = useState(existing?.category ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [link, setLink] = useState(existing?.link ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category.trim() || !name.trim() || !link.trim()) {
      setError(t('master.error.required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        category: category.trim(),
        name: name.trim(),
        link: link.trim(),
      };
      if (existing) {
        await api.updateTrainingManual(existing.id, body);
      } else {
        await api.createTrainingManual(body);
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
        <Field label={t('master.col.category')}>
          <input
            className={FIELD}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <p className={HELP}>{t('master.manuals.category_hint')}</p>
        </Field>
        <Field label={t('master.col.name')}>
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field label={t('master.col.link')}>
        <input
          className={FIELD}
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://"
        />
        <p className={HELP}>{t('master.manuals.link_hint')}</p>
      </Field>
      <FormActions saving={saving} error={error} saved={saved} onCancel={onCancel} />
    </form>
  );
}
