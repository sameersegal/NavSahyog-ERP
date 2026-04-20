import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Child, type School, type Village as VillageT } from '../api';
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

function ChildrenTab({ villageId }: { villageId: number }) {
  const { t, tPlural } = useI18n();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.children(villageId), api.schools(villageId)])
      .then(([c, s]) => {
        setChildren(c.children);
        setSchools(s.schools);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [villageId]);

  useEffect(() => { load(); }, [load]);

  if (err) return <p className="text-danger">{err}</p>;
  if (!children) return <p className="text-muted-fg">{t('common.loading')}</p>;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2">
        <h2 className="text-lg font-semibold">
          {tPlural('children.count', children.length)}
        </h2>
        <button
          onClick={() => setShow((v) => !v)}
          className="text-sm bg-primary hover:bg-primary-hover text-primary-fg rounded px-3 py-1.5"
        >
          {show ? t('common.cancel') : t('children.add')}
        </button>
      </div>
      {show && (
        <AddChildForm
          villageId={villageId}
          schools={schools}
          onAdded={() => {
            setShow(false);
            load();
          }}
        />
      )}
      <ul className="bg-card border border-border rounded divide-y divide-border">
        {children.map((c) => (
          <li
            key={c.id}
            className="p-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
          >
            <span className="font-medium">{c.first_name} {c.last_name}</span>
            <span className="text-xs text-muted-fg">
              {t(`children.form.gender.${c.gender}`)} · {t('children.form.dob')} {c.dob}
            </span>
          </li>
        ))}
        {children.length === 0 && (
          <li className="p-3 text-sm text-muted-fg">{t('children.empty')}</li>
        )}
      </ul>
    </div>
  );
}

function AddChildForm({
  villageId,
  schools,
  onAdded,
}: {
  villageId: number;
  schools: School[];
  onAdded: () => void;
}) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<'m' | 'f' | 'o'>('m');
  const [dob, setDob] = useState('');
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? 0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      // The native <input type="date"> already gives us YYYY-MM-DD.
      await api.addChild({
        village_id: villageId,
        school_id: schoolId,
        first_name: firstName,
        last_name: lastName,
        gender,
        dob,
      });
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus';

  return (
    <form
      onSubmit={submit}
      className="bg-card border border-border rounded p-4 space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">{t('children.form.first_name')}</span>
          <input className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm">{t('children.form.last_name')}</span>
          <input className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm">{t('children.form.gender')}</span>
          <select
            className={field}
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
          <input type="date" className={field} value={dob} onChange={(e) => setDob(e.target.value)} required />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm">{t('children.form.school')}</span>
          <select
            className={field}
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
      {err && <p className="text-sm text-danger">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-3 py-2 text-sm"
      >
        {busy ? t('children.saving') : t('children.save')}
      </button>
    </form>
  );
}

function AttendanceTab({ villageId }: { villageId: number }) {
  const { t } = useI18n();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [marks, setMarks] = useState<Record<number, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const date = todayIstDate();

  useEffect(() => {
    setSaved(false);
    Promise.all([api.children(villageId), api.attendance(villageId, date)])
      .then(([c, a]) => {
        setChildren(c.children);
        const byStudent: Record<number, boolean> = {};
        for (const child of c.children) byStudent[child.id] = true;
        for (const m of a.marks) byStudent[m.student_id] = m.present;
        setMarks(byStudent);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [villageId, date]);

  function setAll(present: boolean) {
    if (!children) return;
    const next: Record<number, boolean> = {};
    for (const c of children) next[c.id] = present;
    setMarks(next);
    setSaved(false);
  }

  function toggleOne(id: number, present: boolean) {
    setMarks((prev) => ({ ...prev, [id]: present }));
    setSaved(false);
  }

  async function submit() {
    if (!children) return;
    setErr(null);
    setBusy(true);
    try {
      await api.submitAttendance({
        village_id: villageId,
        date,
        marks: children.map((c) => ({ student_id: c.id, present: marks[c.id] ?? false })),
      });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    if (!children) return { present: 0, total: 0 };
    let present = 0;
    for (const c of children) if (marks[c.id]) present += 1;
    return { present, total: children.length };
  }, [children, marks]);

  if (err) return <p className="text-danger">{err}</p>;
  if (!children) return <p className="text-muted-fg">{t('common.loading')}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{date}</h2>
          <p className="text-sm text-muted-fg">
            {t('attendance.counts', {
              present: counts.present,
              absent: counts.total - counts.present,
              total: counts.total,
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAll(true)}
            className="text-sm bg-card hover:bg-card-hover border border-border rounded px-3 py-1.5"
          >
            {t('attendance.mark_all_present')}
          </button>
          <button
            onClick={() => setAll(false)}
            className="text-sm bg-card hover:bg-card-hover border border-border rounded px-3 py-1.5"
          >
            {t('attendance.mark_all_absent')}
          </button>
        </div>
      </div>
      <ul className="bg-card border border-border rounded divide-y divide-border">
        {children.map((c) => {
          const present = marks[c.id] ?? false;
          return (
            <li key={c.id}>
              <label className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-card-hover">
                <span className="font-medium">{c.first_name} {c.last_name}</span>
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
      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || children.length === 0}
          className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-4 py-2 text-sm"
        >
          {busy ? t('attendance.saving') : t('attendance.save')}
        </button>
        {saved && <span className="text-primary text-sm">{t('common.saved')}</span>}
      </div>
    </div>
  );
}
