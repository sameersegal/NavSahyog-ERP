// /masters/users — admin user CRUD page (§3.8.7, D21, D24).

import { useCallback, useEffect, useState } from 'react';
import { ROLES, type Role } from '@navsahyog/shared';
import { api, type AdminUser, type GeoLevels } from '../../api';
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

export function Users() {
  const { t } = useI18n();
  const { network } = useSyncState();
  const [geo, setGeo] = useState<GeoLevels | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    api
      .geoAll()
      .then((r) => setGeo(r.levels))
      .catch((e) => setGeoErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  const reload = useCallback(() => {
    api
      .adminUsers()
      .then((r) => setRows(r.users))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="space-y-4">
      <MasterPageHeader
        title={t('master.tab.users')}
        description={t('master.users.description')}
      />
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
          </>
        );
      })()}
    </div>
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
