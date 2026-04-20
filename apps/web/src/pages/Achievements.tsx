import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  can,
  type AchievementType,
  type AchievementWithStudent,
  type Child,
  type Village as VillageT,
} from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

function todayIstDate(): string {
  const istMs = Date.now() + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}
function firstOfMonthIst(): string {
  return todayIstDate().slice(0, 7) + '-01';
}

const FIELD =
  'mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus';

type Panel =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; id: number };

export function Achievements() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canWrite = can(user, 'achievement.write');

  const [villages, setVillages] = useState<VillageT[]>([]);
  const [villageId, setVillageId] = useState<number | null>(null);
  const [from, setFrom] = useState(firstOfMonthIst());
  const [to, setTo] = useState(todayIstDate());
  const [typeFilter, setTypeFilter] = useState<AchievementType | ''>('');
  const [rows, setRows] = useState<AchievementWithStudent[] | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });

  useEffect(() => {
    api
      .villages()
      .then((r) => setVillages(r.villages))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  const load = useCallback(() => {
    setRows(null);
    api
      .achievements({
        village_id: villageId ?? undefined,
        from,
        to,
        type: typeFilter || undefined,
      })
      .then((r) => setRows(r.achievements))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [villageId, from, to, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Children picker source. If the user has scoped into a village via
  // the filter, only that village's children are selectable — matches
  // how a VC experiences the page. With no filter, union across
  // scope-visible villages.
  useEffect(() => {
    if (villageId) {
      api
        .children(villageId)
        .then((r) => setChildren(r.children))
        .catch(() => setChildren([]));
    } else {
      Promise.all(
        villages.map((v) =>
          api.children(v.id).then((r) => r.children).catch(() => []),
        ),
      ).then((lists) => setChildren(lists.flat()));
    }
  }, [villageId, villages]);

  const editing = useMemo(() => {
    if (panel.kind !== 'edit' || !rows) return null;
    return rows.find((r) => r.id === panel.id) ?? null;
  }, [panel, rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('achievements.title')}</h2>
        {canWrite && (
          <button
            onClick={() =>
              setPanel((p) => (p.kind === 'add' ? { kind: 'none' } : { kind: 'add' }))
            }
            className="text-sm bg-primary hover:bg-primary-hover text-primary-fg rounded px-3 py-1.5"
          >
            {panel.kind === 'add' ? t('common.cancel') : t('achievements.add')}
          </button>
        )}
      </div>

      <FilterBar
        villages={villages}
        villageId={villageId}
        onVillage={setVillageId}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        typeFilter={typeFilter}
        onType={setTypeFilter}
      />

      {err && <p className="text-sm text-danger">{err}</p>}

      {canWrite && panel.kind === 'add' && (
        <AchievementForm
          mode="add"
          villages={villages}
          children={children}
          defaultVillageId={villageId}
          onSaved={() => {
            setPanel({ kind: 'none' });
            load();
          }}
          onCancel={() => setPanel({ kind: 'none' })}
        />
      )}

      {canWrite && panel.kind === 'edit' && editing && (
        <AchievementForm
          mode="edit"
          existing={editing}
          villages={villages}
          children={children}
          onSaved={() => {
            setPanel({ kind: 'none' });
            load();
          }}
          onCancel={() => setPanel({ kind: 'none' })}
        />
      )}

      {!rows ? (
        <p className="text-muted-fg">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-fg">{t('achievements.empty')}</p>
      ) : (
        <ul className="bg-card border border-border rounded divide-y divide-border">
          {rows.map((r) => (
            <Row
              key={r.id}
              row={r}
              canWrite={canWrite}
              editingThisOne={panel.kind === 'edit' && panel.id === r.id}
              onEdit={() =>
                setPanel((p) =>
                  p.kind === 'edit' && p.id === r.id
                    ? { kind: 'none' }
                    : { kind: 'edit', id: r.id },
                )
              }
              onDelete={async () => {
                if (!confirm(t('achievements.confirm_delete'))) return;
                try {
                  await api.deleteAchievement(r.id);
                  load();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : 'failed');
                }
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterBar({
  villages,
  villageId,
  onVillage,
  from,
  to,
  onFrom,
  onTo,
  typeFilter,
  onType,
}: {
  villages: VillageT[];
  villageId: number | null;
  onVillage: (v: number | null) => void;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  typeFilter: AchievementType | '';
  onType: (v: AchievementType | '') => void;
}) {
  const { t } = useI18n();
  return (
    <div className="bg-card border border-border rounded p-3 flex flex-wrap items-end gap-3 text-sm">
      <label className="block">
        <span className="text-muted-fg">{t('achievements.filter.village')}</span>
        <select
          className={FIELD}
          value={villageId ?? ''}
          onChange={(e) =>
            onVillage(e.target.value === '' ? null : Number(e.target.value))
          }
        >
          <option value="">{t('achievements.filter.village.all')}</option>
          {villages.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-muted-fg">{t('achievements.filter.from')}</span>
        <input type="date" className={FIELD} value={from} onChange={(e) => onFrom(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-muted-fg">{t('achievements.filter.to')}</span>
        <input type="date" className={FIELD} value={to} onChange={(e) => onTo(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-muted-fg">{t('achievements.filter.type')}</span>
        <select
          className={FIELD}
          value={typeFilter}
          onChange={(e) => onType((e.target.value as AchievementType) || '')}
        >
          <option value="">{t('achievements.filter.type.all')}</option>
          <option value="som">{t('achievements.type.som')}</option>
          <option value="gold">{t('achievements.type.gold')}</option>
          <option value="silver">{t('achievements.type.silver')}</option>
        </select>
      </label>
    </div>
  );
}

function Row({
  row,
  canWrite,
  editingThisOne,
  onEdit,
  onDelete,
}: {
  row: AchievementWithStudent;
  canWrite: boolean;
  editingThisOne: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const count =
    row.type === 'gold' ? row.gold_count ?? 1
    : row.type === 'silver' ? row.silver_count ?? 1
    : null;
  return (
    <li className="p-3 flex flex-wrap items-baseline justify-between gap-3">
      <div className="space-y-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs px-2 py-0.5 rounded bg-card-hover border border-border">
            {t(`achievements.type.${row.type}`)}
            {count !== null ? ` ×${count}` : ''}
          </span>
          <span className="font-medium">
            {row.student_first_name} {row.student_last_name}
          </span>
          <span className="text-xs text-muted-fg">
            · {row.village_name} · {row.date}
          </span>
        </div>
        <p className="text-sm text-muted-fg break-words">{row.description}</p>
      </div>
      {canWrite && (
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="text-xs bg-card hover:bg-card-hover border border-border rounded px-2 py-1"
          >
            {editingThisOne ? t('common.cancel') : t('achievements.edit')}
          </button>
          <button
            onClick={onDelete}
            className="text-xs bg-card hover:bg-card-hover border border-border rounded px-2 py-1 text-danger"
          >
            {t('achievements.delete')}
          </button>
        </div>
      )}
    </li>
  );
}

type FormProps =
  | {
      mode: 'add';
      defaultVillageId: number | null;
      villages: VillageT[];
      children: Child[];
      onSaved: () => void;
      onCancel: () => void;
      existing?: undefined;
    }
  | {
      mode: 'edit';
      existing: AchievementWithStudent;
      villages: VillageT[];
      children: Child[];
      onSaved: () => void;
      onCancel: () => void;
    };

function AchievementForm(props: FormProps) {
  const { mode, villages, children, onSaved, onCancel } = props;
  const { t } = useI18n();

  const isEdit = mode === 'edit';
  const existing = isEdit ? props.existing : undefined;

  const [villageId, setVillageId] = useState<number | null>(
    existing?.village_id ?? (mode === 'add' ? props.defaultVillageId ?? null : null),
  );
  const [studentId, setStudentId] = useState<number | null>(
    existing?.student_id ?? null,
  );
  const [type, setType] = useState<AchievementType>(existing?.type ?? 'som');
  const [date, setDate] = useState(existing?.date ?? todayIstDate());
  const [description, setDescription] = useState(existing?.description ?? '');
  const [medalCount, setMedalCount] = useState<number>(
    existing?.gold_count ?? existing?.silver_count ?? 1,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const childrenInVillage = useMemo(() => {
    if (!villageId) return children;
    return children.filter((c) => c.village_id === villageId);
  }, [children, villageId]);

  // When the village changes, reset the student if the currently
  // selected child isn't in it.
  useEffect(() => {
    if (!studentId) return;
    if (!childrenInVillage.some((c) => c.id === studentId)) {
      setStudentId(childrenInVillage[0]?.id ?? null);
    }
  }, [childrenInVillage, studentId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!studentId) {
      setErr(t('achievements.form.error.student_required'));
      return;
    }
    if (!description.trim()) {
      setErr(t('achievements.form.error.description_required'));
      return;
    }
    setBusy(true);
    try {
      if (mode === 'add') {
        await api.addAchievement({
          student_id: studentId,
          description: description.trim(),
          date,
          type,
          ...(type === 'gold' ? { gold_count: medalCount } : {}),
          ...(type === 'silver' ? { silver_count: medalCount } : {}),
        });
      } else {
        await api.updateAchievement(existing!.id, {
          description: description.trim(),
          date,
          ...(type === 'gold' ? { gold_count: medalCount } : {}),
          ...(type === 'silver' ? { silver_count: medalCount } : {}),
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-card border border-border rounded p-4 space-y-4"
    >
      <h3 className="text-sm font-semibold">
        {isEdit ? t('achievements.edit.title') : t('achievements.add.title')}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">{t('achievements.form.village')}</span>
          <select
            className={FIELD}
            value={villageId ?? ''}
            onChange={(e) => setVillageId(e.target.value ? Number(e.target.value) : null)}
            disabled={isEdit}
            required
          >
            {!isEdit && <option value="">{t('achievements.form.village.pick')}</option>}
            {villages.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm">{t('achievements.form.student')}</span>
          <select
            className={FIELD}
            value={studentId ?? ''}
            onChange={(e) => setStudentId(e.target.value ? Number(e.target.value) : null)}
            disabled={isEdit}
            required
          >
            {!isEdit && <option value="">{t('achievements.form.student.pick')}</option>}
            {childrenInVillage.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name} {c.last_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm">{t('achievements.form.type')}</span>
          <select
            className={FIELD}
            value={type}
            onChange={(e) => setType(e.target.value as AchievementType)}
            disabled={isEdit}
          >
            <option value="som">{t('achievements.type.som')}</option>
            <option value="gold">{t('achievements.type.gold')}</option>
            <option value="silver">{t('achievements.type.silver')}</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm">{t('achievements.form.date')}</span>
          <input
            type="date"
            className={FIELD}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={todayIstDate()}
            required
          />
        </label>
        {(type === 'gold' || type === 'silver') && (
          <label className="block">
            <span className="text-sm">{t('achievements.form.medal_count')}</span>
            <input
              type="number"
              min={1}
              className={FIELD}
              value={medalCount}
              onChange={(e) => setMedalCount(Math.max(1, Number(e.target.value) || 1))}
              required
            />
          </label>
        )}
      </div>
      <label className="block">
        <span className="text-sm">{t('achievements.form.description')}</span>
        <textarea
          className={FIELD + ' min-h-[72px]'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          required
        />
      </label>
      {type === 'som' && (
        <p className="text-xs text-muted-fg">
          {t('achievements.form.som_hint')}
        </p>
      )}
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-3 py-2 text-sm"
        >
          {busy
            ? t('common.saving')
            : isEdit
              ? t('achievements.update')
              : t('achievements.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-card hover:bg-card-hover border border-border rounded px-3 py-2 text-sm"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
