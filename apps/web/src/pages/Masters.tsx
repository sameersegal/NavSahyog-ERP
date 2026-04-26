// L3.1 Master Creations (§3.8.7, decisions.md D21–D24).
//
// Single page with five tabs — one per master. Each tab is a list +
// inline create/edit form. Capability-gated: the route is only
// reachable for users with `user.write` (only Super Admin per §2.3),
// so we don't re-check on every sub-component.
//
// `event.kind` immutability (review-findings H5) is enforced by the
// server; the form mirrors it by disabling the kind toggle when the
// admin row reports `kind_locked = 1`.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLES, type Role } from '@navsahyog/shared';
import {
  api,
  type AdminEvent,
  type AdminSchool,
  type AdminUser,
  type AdminVillage,
  type GeoLevels,
  type Qualification,
} from '../api';
import { useI18n } from '../i18n';

type Tab = 'villages' | 'schools' | 'events' | 'qualifications' | 'users';

const TABS: readonly Tab[] = ['villages', 'schools', 'events', 'qualifications', 'users'];

const FIELD =
  'mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus';
const LABEL = 'block text-sm font-medium';
const HELP = 'mt-1 text-xs text-muted-fg';

export function Masters() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('villages');

  // /api/geo/all is needed by the village + school + user forms.
  // Fetch once at the top so each tab's sub-component reads from
  // memoised state rather than its own fetch.
  const [geo, setGeo] = useState<GeoLevels | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  useEffect(() => {
    api
      .geoAll()
      .then((r) => setGeo(r.levels))
      .catch((e) => setGeoErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('master.title')}</h2>
      <p className="text-sm text-muted-fg">{t('master.description')}</p>

      <nav
        className="flex flex-wrap gap-1 border-b border-border"
        role="tablist"
        aria-label={t('master.title')}
      >
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={
              'px-3 py-2 text-sm border-b-2 -mb-px ' +
              (tab === key
                ? 'border-primary text-fg font-medium'
                : 'border-transparent text-muted-fg hover:text-fg')
            }
          >
            {t(`master.tab.${key}`)}
          </button>
        ))}
      </nav>

      {geoErr && (
        <div className="text-sm text-danger">{geoErr}</div>
      )}

      {tab === 'villages' && <VillagesAdmin geo={geo} />}
      {tab === 'schools' && <SchoolsAdmin geo={geo} />}
      {tab === 'events' && <EventsAdmin />}
      {tab === 'qualifications' && <QualificationsAdmin />}
      {tab === 'users' && <UsersAdmin geo={geo} />}
    </div>
  );
}

// Generic "ok / error / saving" status pill the form panels share.
function StatusLine({ saving, error, saved }: { saving: boolean; error: string | null; saved: boolean }) {
  const { t } = useI18n();
  if (error) return <span className="text-sm text-danger">{error}</span>;
  if (saving) return <span className="text-sm text-muted-fg">{t('common.saving')}</span>;
  if (saved) return <span className="text-sm text-success">{t('common.saved')}</span>;
  return null;
}

// ---- villages -----------------------------------------------------

function VillagesAdmin({ geo }: { geo: GeoLevels | null }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<AdminVillage[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminVillage | null>(null);
  const [showAdd, setShowAdd] = useState(false);

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
    <section className="space-y-3">
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
    </section>
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

// ---- schools ------------------------------------------------------

function SchoolsAdmin({ geo }: { geo: GeoLevels | null }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<AdminSchool[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminSchool | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(() => {
    api
      .adminSchools()
      .then((r) => setRows(r.schools))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(reload, [reload]);

  return (
    <section className="space-y-3">
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
    </section>
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

// ---- events -------------------------------------------------------

function EventsAdmin() {
  const { t } = useI18n();
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
    <section className="space-y-3">
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
    </section>
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

// ---- qualifications ----------------------------------------------

function QualificationsAdmin() {
  const { t } = useI18n();
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
    <section className="space-y-3">
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
    </section>
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

// ---- users --------------------------------------------------------

// Mirrors apps/api/src/routes/users.ts SCOPE_FOR_ROLE — duplicated here
// so the form can pre-emptively show the right scope picker. The
// server is authoritative; this is purely UI scaffolding.
const SCOPE_FOR_ROLE_UI: Record<Role, keyof GeoLevels | null> = {
  vc: 'village',
  af: 'cluster',
  cluster_admin: 'cluster',
  district_admin: 'district',
  region_admin: 'region',
  state_admin: 'state',
  zone_admin: 'zone',
  super_admin: null,
};

function UsersAdmin({ geo }: { geo: GeoLevels | null }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(() => {
    api
      .adminUsers()
      .then((r) => setRows(r.users))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(reload, [reload]);

  return (
    <section className="space-y-3">
      <Toolbar
        addLabel={t('master.users.add')}
        showAdd={showAdd}
        onToggle={() => setShowAdd((v) => !v)}
      />
      <p className={HELP}>{t('master.users.password_note')}</p>
      {showAdd && (
        <UserForm
          geo={geo}
          onCancel={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}
      {editing && (
        <UserForm
          geo={geo}
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
          t('master.col.user_id'),
          t('master.col.full_name'),
          t('master.col.role'),
          t('master.col.scope'),
          '',
        ]}
        rows={(rows ?? []).map((u) => ({
          key: u.id,
          cells: [
            u.user_id,
            u.full_name,
            t(`role.${u.role}`),
            u.scope_name ?? t(`master.scope.${u.scope_level}`),
          ],
          onEdit: () => setEditing(u),
        }))}
        loading={rows === null}
      />
    </section>
  );
}

function UserForm({
  geo,
  existing,
  onCancel,
  onSaved,
}: {
  geo: GeoLevels | null;
  existing?: AdminUser;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [userId, setUserId] = useState(existing?.user_id ?? '');
  const [fullName, setFullName] = useState(existing?.full_name ?? '');
  const [role, setRole] = useState<Role>(existing?.role ?? 'vc');
  const [scopeId, setScopeId] = useState<number | ''>(existing?.scope_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Reset scope_id whenever role changes — the picker source changes,
  // and a stale id from the previous role would 400 on submit.
  useEffect(() => {
    if (existing && role === existing.role) return;
    setScopeId('');
  }, [role, existing]);

  const scopeLevel = SCOPE_FOR_ROLE_UI[role];
  const scopeOptions = scopeLevel && geo ? geo[scopeLevel] : [];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !fullName) {
      setError(t('master.error.required'));
      return;
    }
    if (scopeLevel && !scopeId) {
      setError(t('master.error.required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        user_id: userId,
        full_name: fullName,
        role,
        scope_id: scopeLevel ? Number(scopeId) : null,
      };
      if (existing) {
        await api.updateUser(existing.id, body);
      } else {
        await api.createUser(body);
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
        <Field label={t('master.col.user_id')}>
          <input className={FIELD} value={userId} onChange={(e) => setUserId(e.target.value)} />
          <p className={HELP}>{t('master.users.user_id_hint')}</p>
        </Field>
        <Field label={t('master.col.full_name')}>
          <input className={FIELD} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label={t('master.col.role')}>
          <select
            className={FIELD}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(`role.${r}`)}</option>
            ))}
          </select>
        </Field>
        {scopeLevel ? (
          <Field label={t(`master.scope.${scopeLevel}`)}>
            <select
              className={FIELD}
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">{t(`master.pick.${scopeLevel}`)}</option>
              {scopeOptions.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={t('master.col.scope')}>
            <div className={FIELD + ' bg-muted text-muted-fg'}>
              {t('master.scope.global')}
            </div>
          </Field>
        )}
      </div>
      <FormActions saving={saving} error={error} saved={saved} onCancel={onCancel} />
    </form>
  );
}

// ---- shared bits --------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

function Toolbar({
  addLabel,
  showAdd,
  onToggle,
}: {
  addLabel: string;
  showAdd: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onToggle}
        className="text-sm bg-primary hover:bg-primary-hover text-primary-fg rounded px-3 py-1.5 min-h-[40px]"
      >
        {showAdd ? t('common.cancel') : addLabel}
      </button>
    </div>
  );
}

function FormActions({
  saving,
  error,
  saved,
  onCancel,
}: {
  saving: boolean;
  error: string | null;
  saved: boolean;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={saving}
        className="bg-primary hover:bg-primary-hover text-primary-fg rounded px-3 py-1.5 text-sm min-h-[40px] disabled:opacity-60"
      >
        {saving ? t('common.saving') : t('common.confirm')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="bg-card hover:bg-card-hover text-fg border border-border rounded px-3 py-1.5 text-sm min-h-[40px]"
      >
        {t('common.cancel')}
      </button>
      <StatusLine saving={saving} error={error} saved={saved} />
    </div>
  );
}

type Row = {
  key: number | string;
  cells: Array<string | number>;
  onEdit?: () => void;
};

function Table({
  head,
  rows,
  loading,
  empty,
}: {
  head: string[];
  rows: Row[];
  loading: boolean;
  empty?: string;
}) {
  const { t } = useI18n();
  if (loading) {
    return <div className="text-sm text-muted-fg">{t('common.loading')}</div>;
  }
  if (rows.length === 0) {
    return <div className="text-sm text-muted-fg">{empty ?? t('master.empty')}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-fg">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="font-medium py-2 pr-3 border-b border-border">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border last:border-0">
              {r.cells.map((cell, i) => (
                <td key={i} className="py-2 pr-3 align-top">{cell}</td>
              ))}
              <td className="py-2 pr-0 align-top text-right">
                {r.onEdit && (
                  <button
                    type="button"
                    onClick={r.onEdit}
                    className="text-sm text-primary hover:underline"
                  >
                    {t('master.action.edit')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
