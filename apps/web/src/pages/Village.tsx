import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type AttendanceMark, type Child, type School } from '../api';

type Tab = 'children' | 'attendance';

function fmtDob(epoch: number) {
  const d = new Date(epoch * 1000);
  return d.toISOString().slice(0, 10);
}

function todayUtc() {
  const now = Math.floor(Date.now() / 1000);
  return Math.floor(now / 86400) * 86400;
}

export function Village() {
  const { id } = useParams();
  const villageId = Number(id);
  const [tab, setTab] = useState<Tab>('children');

  if (!villageId) return <p>Invalid village.</p>;

  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm text-emerald-700 hover:underline">
        ← All villages
      </Link>
      <div className="flex gap-4 border-b">
        <TabButton active={tab === 'children'} onClick={() => setTab('children')}>
          Children
        </TabButton>
        <TabButton active={tab === 'attendance'} onClick={() => setTab('attendance')}>
          Attendance (today)
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
          ? 'border-emerald-700 text-emerald-800 font-medium'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

function ChildrenTab({ villageId }: { villageId: number }) {
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

  if (err) return <p className="text-rose-600">{err}</p>;
  if (!children) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{children.length} child{children.length === 1 ? '' : 'ren'}</h2>
        <button
          onClick={() => setShow((v) => !v)}
          className="text-sm bg-emerald-700 hover:bg-emerald-800 text-white rounded px-3 py-1.5"
        >
          {show ? 'Cancel' : 'Add child'}
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
      <ul className="bg-white rounded shadow divide-y">
        {children.map((c) => (
          <li key={c.id} className="p-3 flex justify-between text-sm">
            <span>
              <span className="font-medium">{c.first_name} {c.last_name}</span>
              <span className="ml-2 text-xs text-slate-500">
                {c.gender === 'm' ? 'M' : c.gender === 'f' ? 'F' : 'O'} · DOB {fmtDob(c.dob)}
              </span>
            </span>
          </li>
        ))}
        {children.length === 0 && (
          <li className="p-3 text-sm text-slate-500">No children yet.</li>
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
      const dobEpoch = Math.floor(new Date(dob).getTime() / 1000);
      await api.addChild({
        village_id: villageId,
        school_id: schoolId,
        first_name: firstName,
        last_name: lastName,
        gender,
        dob: dobEpoch,
      });
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-white rounded shadow p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-slate-700">First name</span>
          <input
            className="mt-1 w-full border rounded px-2 py-1.5"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-700">Last name</span>
          <input
            className="mt-1 w-full border rounded px-2 py-1.5"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-700">Gender</span>
          <select
            className="mt-1 w-full border rounded px-2 py-1.5"
            value={gender}
            onChange={(e) => setGender(e.target.value as 'm' | 'f' | 'o')}
          >
            <option value="m">Male</option>
            <option value="f">Female</option>
            <option value="o">Other</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-slate-700">DOB</span>
          <input
            type="date"
            className="mt-1 w-full border rounded px-2 py-1.5"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
          />
        </label>
        <label className="block col-span-2">
          <span className="text-sm text-slate-700">School</span>
          <select
            className="mt-1 w-full border rounded px-2 py-1.5"
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
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white rounded px-3 py-2 text-sm"
      >
        {busy ? 'Saving…' : 'Save child'}
      </button>
    </form>
  );
}

function AttendanceTab({ villageId }: { villageId: number }) {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [marks, setMarks] = useState<Record<number, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const date = todayUtc();

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

  if (err) return <p className="text-rose-600">{err}</p>;
  if (!children) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">
        Attendance for {new Date(date * 1000).toISOString().slice(0, 10)}
      </h2>
      <ul className="bg-white rounded shadow divide-y">
        {children.map((c) => (
          <li key={c.id} className="p-3 flex items-center justify-between">
            <span>{c.first_name} {c.last_name}</span>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={marks[c.id] ?? false}
                onChange={(e) => setMarks({ ...marks, [c.id]: e.target.checked })}
              />
              Present
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || children.length === 0}
          className="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white rounded px-3 py-2 text-sm"
        >
          {busy ? 'Saving…' : 'Save attendance'}
        </button>
        {saved && <span className="text-emerald-700 text-sm">Saved.</span>}
      </div>
    </div>
  );
}
