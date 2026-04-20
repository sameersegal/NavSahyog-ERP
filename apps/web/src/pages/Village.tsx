import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  can,
  isIndianPhone,
  type AttendanceSessionWithMarks,
  type Child,
  type ChildCoreCreate,
  type ChildCorePatch,
  type ChildProfile,
  type Event,
  type GraduationReason,
  type School,
  type Village as VillageT,
} from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

type Tab = 'children' | 'attendance';

// Today as an IST 'YYYY-MM-DD' string. Must match the server's
// `todayIstDate` in apps/api/src/lib/time.ts.
function todayIstDate(): string {
  const istMs = Date.now() + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

export function Village() {
  const { t } = useI18n();
  const { id } = useParams();
  const villageId = Number(id);
  const [tab, setTab] = useState<Tab>('children');
  const [village, setVillage] = useState<VillageT | null>(null);

  useEffect(() => {
    if (!villageId) return;
    api.villages().then((r) => {
      setVillage(r.villages.find((v) => v.id === villageId) ?? null);
    });
  }, [villageId]);

  if (!villageId) return <p>Invalid village.</p>;

  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm text-primary hover:underline">
        {t('village.back')}
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{village?.name ?? ''}</h1>
        {village && (
          <p className="text-xs text-muted-fg">
            {village.cluster_name} · {village.code}
          </p>
        )}
      </div>
      <div className="flex gap-4 border-b border-border">
        <TabButton active={tab === 'children'} onClick={() => setTab('children')}>
          {t('village.tab.children')}
        </TabButton>
        <TabButton active={tab === 'attendance'} onClick={() => setTab('attendance')}>
          {t('village.tab.attendance')}
        </TabButton>
      </div>
      {tab === 'children' ? (
        <ChildrenTab villageId={villageId} />
      ) : (
        <AttendanceTab villageId={villageId} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm -mb-px border-b-2 ${
        active
          ? 'border-primary text-primary font-medium'
          : 'border-transparent text-muted-fg hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

// Per-row panel state. Only one panel can be open at a time across
// the entire list, including the top-level "Add child" panel.
type Panel =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; childId: number }
  | { kind: 'graduate'; childId: number };

function ChildrenTab({ villageId }: { villageId: number }) {
  const { t, tPlural } = useI18n();
  const { user } = useAuth();
  const canWrite = can(user, 'child.write');
  const [children, setChildren] = useState<Child[] | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [includeGraduated, setIncludeGraduated] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });

  const load = useCallback(() => {
    Promise.all([
      api.children(villageId, { includeGraduated }),
      api.schools(villageId),
    ])
      .then(([c, s]) => {
        setChildren(c.children);
        setSchools(s.schools);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [villageId, includeGraduated]);

  useEffect(() => { load(); }, [load]);

  if (err) return <p className="text-danger">{err}</p>;
  if (!children) return <p className="text-muted-fg">{t('common.loading')}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {tPlural('children.count', children.length)}
        </h2>
        <div className="flex items-center gap-3">
          <label className="text-sm flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeGraduated}
              onChange={(e) => {
                setIncludeGraduated(e.target.checked);
                setPanel({ kind: 'none' });
              }}
              className="w-4 h-4 accent-[hsl(var(--primary))]"
            />
            {includeGraduated ? t('children.hide_graduated') : t('children.show_graduated')}
          </label>
          {canWrite && (
            <button
              onClick={() =>
                setPanel((p) => (p.kind === 'add' ? { kind: 'none' } : { kind: 'add' }))
              }
              className="text-sm bg-primary hover:bg-primary-hover text-primary-fg rounded px-3 py-1.5"
            >
              {panel.kind === 'add' ? t('common.cancel') : t('children.add')}
            </button>
          )}
        </div>
      </div>
      {canWrite && panel.kind === 'add' && (
        <ChildForm
          mode="add"
          villageId={villageId}
          schools={schools}
          onSaved={() => {
            setPanel({ kind: 'none' });
            load();
          }}
          onCancel={() => setPanel({ kind: 'none' })}
        />
      )}
      <ul className="bg-card border border-border rounded divide-y divide-border">
        {children.map((c) => {
          const isEditing = panel.kind === 'edit' && panel.childId === c.id;
          const isGraduating = panel.kind === 'graduate' && panel.childId === c.id;
          return (
            <li key={c.id} className="p-3 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{c.first_name} {c.last_name}</span>
                  <span className="text-xs text-muted-fg">
                    {t(`children.form.gender.${c.gender}`)} · {t('children.form.dob')} {c.dob}
                  </span>
                  {c.graduated_at && (
                    <span
                      title={
                        c.graduation_reason
                          ? t(`children.graduation_reason.${c.graduation_reason}`)
                          : undefined
                      }
                      className="text-xs px-1.5 py-0.5 rounded bg-card-hover border border-border text-muted-fg"
                    >
                      {t('children.graduated_at', { date: c.graduated_at })}
                    </span>
                  )}
                </div>
                {canWrite && !c.graduated_at && (
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setPanel((p) =>
                          p.kind === 'edit' && p.childId === c.id
                            ? { kind: 'none' }
                            : { kind: 'edit', childId: c.id },
                        )
                      }
                      className="text-xs bg-card hover:bg-card-hover border border-border rounded px-2 py-1"
                    >
                      {isEditing ? t('common.cancel') : t('children.edit')}
                    </button>
                    <button
                      onClick={() =>
                        setPanel((p) =>
                          p.kind === 'graduate' && p.childId === c.id
                            ? { kind: 'none' }
                            : { kind: 'graduate', childId: c.id },
                        )
                      }
                      className="text-xs bg-card hover:bg-card-hover border border-border rounded px-2 py-1"
                    >
                      {isGraduating ? t('common.cancel') : t('children.graduate')}
                    </button>
                  </div>
                )}
              </div>
              {isEditing && (
                <ChildForm
                  mode="edit"
                  villageId={villageId}
                  schools={schools}
                  child={c}
                  onSaved={() => {
                    setPanel({ kind: 'none' });
                    load();
                  }}
                  onCancel={() => setPanel({ kind: 'none' })}
                />
              )}
              {isGraduating && (
                <GraduatePanel
                  child={c}
                  onSaved={() => {
                    setPanel({ kind: 'none' });
                    load();
                  }}
                  onCancel={() => setPanel({ kind: 'none' })}
                />
              )}
            </li>
          );
        })}
        {children.length === 0 && (
          <li className="p-3 text-sm text-muted-fg">{t('children.empty')}</li>
        )}
      </ul>
    </div>
  );
}

const FIELD =
  'mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus';

type ChildFormProps =
  | {
      mode: 'add';
      villageId: number;
      schools: School[];
      onSaved: () => void;
      onCancel: () => void;
      child?: undefined;
    }
  | {
      mode: 'edit';
      villageId: number;
      schools: School[];
      child: Child;
      onSaved: () => void;
      onCancel: () => void;
    };

function ChildForm(props: ChildFormProps) {
  const { mode, villageId, schools, child, onSaved, onCancel } = props;
  const { t } = useI18n();
  const [firstName, setFirstName] = useState(child?.first_name ?? '');
  const [lastName, setLastName] = useState(child?.last_name ?? '');
  const [gender, setGender] = useState<'m' | 'f' | 'o'>(child?.gender ?? 'm');
  const [dob, setDob] = useState(child?.dob ?? '');
  const [joinedAt, setJoinedAt] = useState(child?.joined_at ?? '');
  const [schoolId, setSchoolId] = useState<number>(
    child?.school_id ?? schools[0]?.id ?? 0,
  );
  const [fatherName, setFatherName] = useState(child?.father_name ?? '');
  const [fatherPhone, setFatherPhone] = useState(child?.father_phone ?? '');
  const [fatherSmartphone, setFatherSmartphone] = useState(
    child?.father_has_smartphone === 1,
  );
  const [motherName, setMotherName] = useState(child?.mother_name ?? '');
  const [motherPhone, setMotherPhone] = useState(child?.mother_phone ?? '');
  const [motherSmartphone, setMotherSmartphone] = useState(
    child?.mother_has_smartphone === 1,
  );
  const [altName, setAltName] = useState(child?.alt_contact_name ?? '');
  const [altPhone, setAltPhone] = useState(child?.alt_contact_phone ?? '');
  const [altRelationship, setAltRelationship] = useState(
    child?.alt_contact_relationship ?? '',
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // §3.3 alt-contact rule mirrored client-side: required when at least
  // one parent has a phone but neither has a smartphone. Server is the
  // source of truth — this is a UX hint only.
  const anyParentPhone = fatherPhone.trim() !== '' || motherPhone.trim() !== '';
  const anyParentSmartphone =
    (fatherPhone.trim() !== '' && fatherSmartphone) ||
    (motherPhone.trim() !== '' && motherSmartphone);
  const altRequired = anyParentPhone && !anyParentSmartphone;

  function profileBody(): ChildProfile {
    const father = fatherName.trim() || fatherPhone.trim() ? {
      father_name: fatherName.trim() || null,
      father_phone: fatherPhone.trim() || null,
      father_has_smartphone: fatherPhone.trim() ? fatherSmartphone : null,
    } : { father_name: null, father_phone: null, father_has_smartphone: null };
    const mother = motherName.trim() || motherPhone.trim() ? {
      mother_name: motherName.trim() || null,
      mother_phone: motherPhone.trim() || null,
      mother_has_smartphone: motherPhone.trim() ? motherSmartphone : null,
    } : { mother_name: null, mother_phone: null, mother_has_smartphone: null };
    const alt = altName.trim() || altPhone.trim() || altRelationship.trim() ? {
      alt_contact_name: altName.trim() || null,
      alt_contact_phone: altPhone.trim() || null,
      alt_contact_relationship: altRelationship.trim() || null,
    } : { alt_contact_name: null, alt_contact_phone: null, alt_contact_relationship: null };
    return { ...father, ...mother, ...alt };
  }

  function clientValidate(): string | null {
    if (!fatherName.trim() && !motherName.trim()) {
      return 'at least one parent name required';
    }
    for (const [label, phone] of [
      ['father', fatherPhone],
      ['mother', motherPhone],
      ['alt', altPhone],
    ] as const) {
      const v = phone.trim();
      if (v && !isIndianPhone(v)) return `${label} phone must be a valid Indian mobile number`;
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const v = clientValidate();
    if (v) { setErr(v); return; }
    setBusy(true);
    try {
      if (mode === 'add') {
        const body: ChildCoreCreate & ChildProfile = {
          village_id: villageId,
          school_id: schoolId,
          first_name: firstName,
          last_name: lastName,
          gender,
          dob,
          ...(joinedAt ? { joined_at: joinedAt } : {}),
          ...profileBody(),
        };
        await api.addChild(body);
      } else {
        const body: ChildCorePatch & ChildProfile = {
          school_id: schoolId,
          first_name: firstName,
          last_name: lastName,
          gender,
          dob,
          ...(joinedAt ? { joined_at: joinedAt } : {}),
          ...profileBody(),
        };
        await api.updateChild(child!.id, body);
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
      {mode === 'edit' && (
        <h3 className="text-sm font-semibold">{t('children.edit.title')}</h3>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">{t('children.form.first_name')}</span>
          <input className={FIELD} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm">{t('children.form.last_name')}</span>
          <input className={FIELD} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm">{t('children.form.gender')}</span>
          <select
            className={FIELD}
            value={gender}
            onChange={(e) => setGender(e.target.value as 'm' | 'f' | 'o')}
          >
            <option value="m">{t('children.form.gender.m')}</option>
            <option value="f">{t('children.form.gender.f')}</option>
            <option value="o">{t('children.form.gender.o')}</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm">{t('children.form.dob')}</span>
          <input type="date" className={FIELD} value={dob} onChange={(e) => setDob(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm">{t('children.form.joined_at')}</span>
          <input type="date" className={FIELD} value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm">{t('children.form.school')}</span>
          <select
            className={FIELD}
            value={schoolId}
            onChange={(e) => setSchoolId(Number(e.target.value))}
            required
          >
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t('children.form.parents')}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm">{t('children.form.father_name')}</span>
            <input className={FIELD} value={fatherName} onChange={(e) => setFatherName(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm">{t('children.form.father_phone')}</span>
            <input
              className={FIELD}
              value={fatherPhone}
              onChange={(e) => setFatherPhone(e.target.value)}
              type="tel"
              autoComplete="off"
              placeholder="+91"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fatherSmartphone}
              onChange={(e) => setFatherSmartphone(e.target.checked)}
              disabled={fatherPhone.trim() === ''}
              className="w-4 h-4 accent-[hsl(var(--primary))] disabled:opacity-50"
            />
            {t('children.form.father_smartphone')}
          </label>
          <span />
          <label className="block">
            <span className="text-sm">{t('children.form.mother_name')}</span>
            <input className={FIELD} value={motherName} onChange={(e) => setMotherName(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm">{t('children.form.mother_phone')}</span>
            <input
              className={FIELD}
              value={motherPhone}
              onChange={(e) => setMotherPhone(e.target.value)}
              type="tel"
              autoComplete="off"
              placeholder="+91"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={motherSmartphone}
              onChange={(e) => setMotherSmartphone(e.target.checked)}
              disabled={motherPhone.trim() === ''}
              className="w-4 h-4 accent-[hsl(var(--primary))] disabled:opacity-50"
            />
            {t('children.form.mother_smartphone')}
          </label>
        </div>
        <p className="text-xs text-muted-fg">{t('children.form.phone_hint')}</p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t('children.form.alt_contact')}</legend>
        {altRequired && (
          <p className="text-xs text-danger">
            {t('children.form.alt_contact.required_hint')}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-sm">{t('children.form.alt_contact_name')}</span>
            <input className={FIELD} value={altName} onChange={(e) => setAltName(e.target.value)} required={altRequired} />
          </label>
          <label className="block">
            <span className="text-sm">{t('children.form.alt_contact_phone')}</span>
            <input
              className={FIELD}
              value={altPhone}
              onChange={(e) => setAltPhone(e.target.value)}
              type="tel"
              autoComplete="off"
              placeholder="+91"
              required={altRequired}
            />
          </label>
          <label className="block">
            <span className="text-sm">{t('children.form.alt_contact_relationship')}</span>
            <input className={FIELD} value={altRelationship} onChange={(e) => setAltRelationship(e.target.value)} required={altRequired} />
          </label>
        </div>
      </fieldset>

      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-3 py-2 text-sm"
        >
          {busy
            ? t('children.saving')
            : mode === 'add'
              ? t('children.save')
              : t('children.update')}
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

function GraduatePanel({
  child,
  onSaved,
  onCancel,
}: {
  child: Child;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [graduatedAt, setGraduatedAt] = useState(todayIstDate());
  const [reason, setReason] = useState<GraduationReason>('pass_out');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.graduateChild(child.id, {
        graduated_at: graduatedAt,
        graduation_reason: reason,
      });
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
      className="bg-card border border-border rounded p-3 space-y-3"
    >
      <h4 className="text-sm font-semibold">
        {t('children.graduate.title', { name: `${child.first_name} ${child.last_name}` })}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">{t('children.graduate.date')}</span>
          <input
            type="date"
            className={FIELD}
            value={graduatedAt}
            min={child.joined_at}
            max={todayIstDate()}
            onChange={(e) => setGraduatedAt(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="text-sm">{t('children.graduate.reason')}</span>
          <select
            className={FIELD}
            value={reason}
            onChange={(e) => setReason(e.target.value as GraduationReason)}
          >
            <option value="pass_out">{t('children.graduate.reason.pass_out')}</option>
            <option value="other">{t('children.graduate.reason.other')}</option>
          </select>
        </label>
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-3 py-2 text-sm"
        >
          {busy ? t('children.saving') : t('children.graduate.confirm')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-card hover:bg-card-hover border border-border rounded px-3 py-2 text-sm"
        >
          {t('children.graduate.cancel')}
        </button>
      </div>
    </form>
  );
}

// Allowed date offsets (§3.3.1): today, today-1, today-2.
function dateOffset(days: number): string {
  const istMs = Date.now() + (5 * 60 + 30) * 60 * 1000 - days * 24 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

type Editor =
  | { mode: 'new' }
  | { mode: 'edit'; session: AttendanceSessionWithMarks };

function AttendanceTab({ villageId }: { villageId: number }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const canWrite = can(user, 'attendance.write');
  const [date, setDate] = useState(todayIstDate());
  const [children, setChildren] = useState<Child[] | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [sessions, setSessions] = useState<AttendanceSessionWithMarks[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.children(villageId),
      api.events(),
      api.attendance(villageId, date),
    ])
      .then(([c, e, a]) => {
        setChildren(c.children);
        setEvents(e.events);
        setSessions(a.sessions);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [villageId, date]);

  useEffect(() => {
    setEditor(null);
    load();
  }, [load]);

  if (err) return <p className="text-danger">{err}</p>;
  if (!children) return <p className="text-muted-fg">{t('common.loading')}</p>;

  const dateOptions = [
    { value: todayIstDate(), label: t('attendance.date.today') },
    { value: dateOffset(1), label: t('attendance.date.yesterday') },
    { value: dateOffset(2), label: t('attendance.date.day_before') },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm flex items-center gap-2">
          <span className="text-muted-fg">{t('attendance.date.label')}</span>
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus"
          >
            {dateOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} · {o.value}
              </option>
            ))}
          </select>
        </label>
        {canWrite && !editor && (
          <button
            onClick={() => setEditor({ mode: 'new' })}
            className="text-sm bg-primary hover:bg-primary-hover text-primary-fg rounded px-3 py-1.5"
          >
            {t('attendance.new_session')}
          </button>
        )}
      </div>

      <SessionList
        sessions={sessions}
        canWrite={canWrite}
        onEdit={(s) => setEditor({ mode: 'edit', session: s })}
      />

      {canWrite && editor && (
        <SessionForm
          key={editor.mode === 'edit' ? editor.session.id : 'new'}
          villageId={villageId}
          date={date}
          events={events}
          children={children}
          existing={editor.mode === 'edit' ? editor.session : null}
          onSaved={() => {
            setEditor(null);
            load();
          }}
          onCancel={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function SessionList({
  sessions,
  canWrite,
  onEdit,
}: {
  sessions: AttendanceSessionWithMarks[];
  canWrite: boolean;
  onEdit: (s: AttendanceSessionWithMarks) => void;
}) {
  const { t } = useI18n();
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-fg">{t('attendance.none_for_date')}</p>
    );
  }
  return (
    <ul className="bg-card border border-border rounded divide-y divide-border">
      {sessions.map((s) => {
        const present = s.marks.filter((m) => m.present).length;
        return (
          <li key={s.id} className="p-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">
                {s.event_name}
                <span className="ml-2 text-xs text-muted-fg">
                  {t(`event.kind.${s.event_kind}`)}
                </span>
              </div>
              <div className="text-xs text-muted-fg">
                {s.start_time}–{s.end_time} ·{' '}
                {t('attendance.session.summary', {
                  present,
                  total: s.marks.length,
                })}
              </div>
            </div>
            {canWrite && (
              <button
                onClick={() => onEdit(s)}
                className="text-xs bg-card hover:bg-card-hover border border-border rounded px-2 py-1"
              >
                {t('attendance.edit_session')}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SessionForm({
  villageId,
  date,
  events,
  children,
  existing,
  onSaved,
  onCancel,
}: {
  villageId: number;
  date: string;
  events: Event[];
  children: Child[];
  existing: AttendanceSessionWithMarks | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [eventId, setEventId] = useState<number>(
    existing?.event_id ?? events[0]?.id ?? 0,
  );
  const [startTime, setStartTime] = useState(existing?.start_time ?? '10:00');
  const [endTime, setEndTime] = useState(existing?.end_time ?? '11:00');
  const initialMarks = useMemo(() => {
    const byStudent: Record<number, boolean> = {};
    for (const c of children) byStudent[c.id] = true;
    if (existing) {
      for (const m of existing.marks) byStudent[m.student_id] = m.present;
    }
    return byStudent;
  }, [children, existing]);
  const [marks, setMarks] = useState<Record<number, boolean>>(initialMarks);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const counts = useMemo(() => {
    let present = 0;
    for (const c of children) if (marks[c.id]) present += 1;
    return { present, total: children.length };
  }, [children, marks]);

  function setAll(present: boolean) {
    const next: Record<number, boolean> = {};
    for (const c of children) next[c.id] = present;
    setMarks(next);
  }

  function toggleOne(id: number, present: boolean) {
    setMarks((prev) => ({ ...prev, [id]: present }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!eventId) { setErr(t('attendance.error.event_required')); return; }
    if (endTime < startTime) {
      setErr(t('attendance.error.end_before_start'));
      return;
    }
    setBusy(true);
    try {
      await api.submitAttendance({
        village_id: villageId,
        event_id: eventId,
        date,
        start_time: startTime,
        end_time: endTime,
        marks: children.map((c) => ({
          student_id: c.id,
          present: marks[c.id] ?? false,
        })),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  // On edit, event_id is part of the natural key — changing it would
  // create a new session rather than modify the existing one, which
  // is surprising. Lock it down so the user either edits in place or
  // cancels and starts a new session.
  const eventLocked = existing !== null;

  return (
    <form
      onSubmit={submit}
      className="bg-card border border-border rounded p-4 space-y-4"
    >
      <h3 className="text-sm font-semibold">
        {existing ? t('attendance.edit.title') : t('attendance.new.title')}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block sm:col-span-3">
          <span className="text-sm">{t('attendance.form.event')}</span>
          <select
            className={FIELD}
            value={eventId}
            onChange={(e) => setEventId(Number(e.target.value))}
            disabled={eventLocked}
            required
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} — {t(`event.kind.${ev.kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm">{t('attendance.form.start_time')}</span>
          <input
            type="time"
            className={FIELD}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="text-sm">{t('attendance.form.end_time')}</span>
          <input
            type="time"
            className={FIELD}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-fg">
          {t('attendance.counts', {
            present: counts.present,
            absent: counts.total - counts.present,
            total: counts.total,
          })}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAll(true)}
            className="text-sm bg-card hover:bg-card-hover border border-border rounded px-3 py-1.5"
          >
            {t('attendance.mark_all_present')}
          </button>
          <button
            type="button"
            onClick={() => setAll(false)}
            className="text-sm bg-card hover:bg-card-hover border border-border rounded px-3 py-1.5"
          >
            {t('attendance.mark_all_absent')}
          </button>
        </div>
      </div>

      <ul className="border border-border rounded divide-y divide-border">
        {children.map((c) => {
          const present = marks[c.id] ?? false;
          return (
            <li key={c.id}>
              <label className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-card-hover">
                <span className="font-medium">
                  {c.first_name} {c.last_name}
                </span>
                <span className="inline-flex items-center gap-2 text-sm">
                  <span className={present ? 'text-primary' : 'text-muted-fg'}>
                    {present ? t('attendance.present') : t('attendance.absent')}
                  </span>
                  <input
                    type="checkbox"
                    checked={present}
                    onChange={(e) => toggleOne(c.id, e.target.checked)}
                    className="w-5 h-5 accent-[hsl(var(--primary))]"
                  />
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || children.length === 0}
          className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-4 py-2 text-sm"
        >
          {busy ? t('attendance.saving') : t('attendance.save')}
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
