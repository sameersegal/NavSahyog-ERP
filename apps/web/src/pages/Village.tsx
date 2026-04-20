import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type MediaWithUrls,
  type School,
  type Village as VillageT,
} from '../api';
import {
  captureGps,
  canonicalMime,
  MAX_UPLOAD_BYTES,
  uploadMedia,
} from '../lib/media';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

type Tab = 'children' | 'attendance' | 'media';

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
        <TabButton active={tab === 'media'} onClick={() => setTab('media')}>
          {t('village.tab.media')}
        </TabButton>
      </div>
      {tab === 'children' ? (
        <ChildrenTab villageId={villageId} />
      ) : tab === 'attendance' ? (
        <AttendanceTab villageId={villageId} />
      ) : (
        <MediaTab villageId={villageId} />
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

// Child-photo picker. Wraps a hidden `<input type=file>` with
// `accept=image/*` + `capture=environment` — on Android this opens
// the camera; on desktop it falls through to the file chooser. The
// selected file is uploaded immediately so the form only needs to
// send the resulting media id (photo_media_id) on save. Deferring
// upload to submit would complicate retry: a failed PUT mid-submit
// would wipe the whole form.
function PhotoPicker({
  villageId,
  value,
  onChange,
}: {
  villageId: number;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load existing thumbnail on edit. Fire only when value changes,
  // not on every re-render, so the URL doesn't flicker.
  useEffect(() => {
    let cancelled = false;
    if (value === null) {
      setPreview(null);
      return;
    }
    api.getMedia(value).then((r) => {
      if (!cancelled) setPreview(r.media.thumb_url);
    }).catch(() => { if (!cancelled) setPreview(null); });
    return () => { cancelled = true; };
  }, [value]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(t('media.error.too_big'));
      }
      const gps = await captureGps();
      const result = await uploadMedia({
        file,
        kind: 'image',
        mime: canonicalMime(file.type) || 'image/jpeg',
        villageId,
        gps,
      });
      onChange(result.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('media.error.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{t('children.form.photo')}</legend>
      <div className="flex items-start gap-3">
        <div className="w-20 h-20 rounded border border-border bg-card overflow-hidden flex items-center justify-center text-xs text-muted-fg shrink-0">
          {preview ? (
            <img src={preview} alt="" className="w-full h-full object-cover" />
          ) : (
            t('children.form.photo.none')
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onFile}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="bg-card hover:bg-card-hover border border-border rounded px-3 py-1.5 text-sm disabled:opacity-60"
            >
              {busy
                ? t('media.uploading')
                : value !== null
                  ? t('children.form.photo.replace')
                  : t('children.form.photo.pick')}
            </button>
            {value !== null && (
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={busy}
                className="text-sm text-muted-fg hover:text-danger"
              >
                {t('children.form.photo.remove')}
              </button>
            )}
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
          <p className="text-xs text-muted-fg">{t('children.form.photo.hint')}</p>
        </div>
      </div>
    </fieldset>
  );
}

function ChildForm(props: ChildFormProps) {
  const { mode, villageId, schools, child, onSaved, onCancel } = props;
  const { t } = useI18n();
  const [firstName, setFirstName] = useState(child?.first_name ?? '');
  const [lastName, setLastName] = useState(child?.last_name ?? '');
  const [gender, setGender] = useState<'m' | 'f' | 'o'>(child?.gender ?? 'm');
  const [dob, setDob] = useState(child?.dob ?? '');
  const [joinedAt, setJoinedAt] = useState(child?.joined_at ?? '');
  const [photoMediaId, setPhotoMediaId] = useState<number | null>(
    child?.photo_media_id ?? null,
  );
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
          ...(photoMediaId !== null ? { photo_media_id: photoMediaId } : {}),
          ...profileBody(),
        };
        await api.addChild(body);
      } else {
        // Include photo only if it changed; undefined preserves the
        // server-side value on PATCH per the key-present-vs-absent
        // contract.
        const photoKey: { photo_media_id?: number | null } =
          photoMediaId !== (child?.photo_media_id ?? null)
            ? { photo_media_id: photoMediaId }
            : {};
        const body: ChildCorePatch & ChildProfile = {
          school_id: schoolId,
          first_name: firstName,
          last_name: lastName,
          gender,
          dob,
          ...(joinedAt ? { joined_at: joinedAt } : {}),
          ...photoKey,
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

      <PhotoPicker
        villageId={villageId}
        value={photoMediaId}
        onChange={setPhotoMediaId}
      />

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

      <AltContactSection
        altName={altName}
        setAltName={setAltName}
        altPhone={altPhone}
        setAltPhone={setAltPhone}
        altRelationship={altRelationship}
        setAltRelationship={setAltRelationship}
        altRequired={altRequired}
      />

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

// Alt-contact block hidden behind a disclosure when it's not
// required (i.e. at least one parent has a smartphone). This keeps
// the child form short for the common case and reminds the VC to
// fill it only when §3.3 demands.
function AltContactSection({
  altName,
  setAltName,
  altPhone,
  setAltPhone,
  altRelationship,
  setAltRelationship,
  altRequired,
}: {
  altName: string;
  setAltName: (v: string) => void;
  altPhone: string;
  setAltPhone: (v: string) => void;
  altRelationship: string;
  setAltRelationship: (v: string) => void;
  altRequired: boolean;
}) {
  const { t } = useI18n();
  const hasValue =
    altName.trim() !== '' || altPhone.trim() !== '' || altRelationship.trim() !== '';
  // Open when required, when already filled, or when the user
  // clicks the "Add alt contact" CTA. Closed otherwise to keep the
  // form short.
  const [open, setOpen] = useState(altRequired || hasValue);
  useEffect(() => {
    if (altRequired || hasValue) setOpen(true);
  }, [altRequired, hasValue]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-primary hover:underline"
      >
        {t('children.form.alt_contact.add')}
      </button>
    );
  }
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">
        {t('children.form.alt_contact')}
      </legend>
      {altRequired ? (
        <p className="text-xs text-danger">
          {t('children.form.alt_contact.required_hint')}
        </p>
      ) : (
        <p className="text-xs text-muted-fg">
          {t('children.form.alt_contact.optional_hint')}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <AltContactFieldsSlot
          altName={altName}
          setAltName={setAltName}
          altPhone={altPhone}
          setAltPhone={setAltPhone}
          altRelationship={altRelationship}
          setAltRelationship={setAltRelationship}
          altRequired={altRequired}
        />
      </div>
    </fieldset>
  );
}

function AltContactFieldsSlot({
  altName,
  setAltName,
  altPhone,
  setAltPhone,
  altRelationship,
  setAltRelationship,
  altRequired,
}: {
  altName: string;
  setAltName: (v: string) => void;
  altPhone: string;
  setAltPhone: (v: string) => void;
  altRelationship: string;
  setAltRelationship: (v: string) => void;
  altRequired: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
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
    </>
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

function CountBadge({
  variant,
  label,
}: {
  variant: 'present' | 'absent';
  label: string;
}) {
  const cls =
    variant === 'present'
      ? 'bg-primary/15 text-primary'
      : 'bg-danger/10 text-danger';
  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium ${cls}`}>
      {label}
    </span>
  );
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
  const [toast, setToast] = useState<string | null>(null);

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

      {toast && (
        <div className="bg-primary/10 border border-primary/30 text-primary rounded px-3 py-2 text-sm">
          {toast}
        </div>
      )}

      {canWrite && editor && (
        <SessionForm
          key={editor.mode === 'edit' ? editor.session.id : 'new'}
          villageId={villageId}
          date={date}
          events={events}
          children={children}
          existing={editor.mode === 'edit' ? editor.session : null}
          onSaved={(summary) => {
            setEditor(null);
            // Post-save comparison toast: pct against the best pct
            // in the (now-reloaded) session list for this date. On
            // first save of the day the toast says "steady"; once
            // there are siblings we can promote to "best/ matches".
            if (summary) {
              const priorBest = sessions.reduce((best, s) => {
                if (s.marks.length === 0) return best;
                const p = Math.round(
                  (s.marks.filter((m) => m.present).length / s.marks.length) * 100,
                );
                return Math.max(best, p);
              }, 0);
              const thisPct = summary.total === 0 ? 0 : Math.round((summary.present / summary.total) * 100);
              const hint =
                thisPct > priorBest
                  ? t('streak.toast.best_of_week')
                  : thisPct === priorBest
                    ? t('streak.toast.matches_best')
                    : t('streak.toast.steady');
              setToast(
                t('streak.toast.saved', {
                  present: summary.present,
                  total: summary.total,
                  hint,
                }),
              );
              setTimeout(() => setToast(null), 4000);
            }
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

// Voice-note recorder — wraps MediaRecorder. On stop, the Blob is
// uploaded immediately (same reasoning as PhotoPicker: defer-to-
// submit would complicate retry). Preview uses a native <audio> tag
// that picks up the same blob URL, so the user can hear it before
// saving the session.
//
// MIME: MediaRecorder on Chrome emits `audio/webm`, on Safari
// `audio/mp4`. Both are in the server allow-list (apps/api/src/lib/
// media.ts). Codec suffix is stripped via canonicalMime.
function VoiceNoteRecorder({
  villageId,
  value,
  onChange,
}: {
  villageId: number;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const { t } = useI18n();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Existing voice note: fetch its raw URL once so the playback
  // preview shows on edit. We rely on the /api/media/raw endpoint
  // which authenticates via session cookie.
  useEffect(() => {
    let cancelled = false;
    if (value === null) {
      setBlobUrl(null);
      return;
    }
    // Only hit the endpoint if we don't already have a local blob
    // (covers the case where the user just recorded a new clip).
    setBlobUrl((existing) => existing ?? `/api/media/raw/${value}`);
    return () => { cancelled = true; };
  }, [value]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => clearInterval(t);
  }, [recording]);

  // Stop + release the mic when the component unmounts (e.g. user
  // cancels the form mid-recording). Without this the browser shows
  // a "mic in use" indicator until the tab closes.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
  }, []);

  async function start() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const mime = canonicalMime(rec.mimeType) || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        chunksRef.current = [];
        setBlobUrl(URL.createObjectURL(blob));
        await upload(blob, mime);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('media.error.mic_denied'));
    }
  }

  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function upload(blob: Blob, mime: string) {
    setBusy(true);
    try {
      const gps = await captureGps();
      const result = await uploadMedia({
        file: blob,
        kind: 'audio',
        mime,
        villageId,
        gps,
      });
      onChange(result.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('media.error.failed'));
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    onChange(null);
    setBlobUrl(null);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{t('attendance.form.voice_note')}</legend>
      <div className="flex flex-wrap items-center gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="bg-card hover:bg-card-hover border border-border rounded px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {value !== null
              ? t('attendance.form.voice_note.rerecord')
              : t('attendance.form.voice_note.record')}
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="bg-danger hover:bg-danger text-primary-fg rounded px-3 py-1.5 text-sm"
          >
            {t('attendance.form.voice_note.stop', { s: elapsed })}
          </button>
        )}
        {blobUrl && !recording && (
          <audio src={blobUrl} controls className="h-8" />
        )}
        {value !== null && !recording && (
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="text-sm text-muted-fg hover:text-danger"
          >
            {t('attendance.form.voice_note.remove')}
          </button>
        )}
        {busy && <span className="text-xs text-muted-fg">{t('media.uploading')}</span>}
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      <p className="text-xs text-muted-fg">{t('attendance.form.voice_note.hint')}</p>
    </fieldset>
  );
}

// Minutes between two HH:MM strings. Negative when end < start.
function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh! * 60 + em!) - (sh! * 60 + sm!);
}
// HH:MM rounded to the nearest 5 minutes, IST wall clock.
function nowIstClock(): string {
  const ist = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  let m = ist.getUTCMinutes();
  const rounded = Math.round(m / 5) * 5;
  const addH = rounded === 60 ? 1 : 0;
  const mm = rounded === 60 ? 0 : rounded;
  const hh = (ist.getUTCHours() + addH) % 24;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h! * 60 + m! + mins + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Typical session lengths from the onboarding doc. These map to
// single-tap chips so the VC never types a time.
const DURATION_CHIPS = [30, 45, 60, 90] as const;

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
  onSaved: (summary?: { present: number; total: number }) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [eventId, setEventId] = useState<number>(
    existing?.event_id ?? events[0]?.id ?? 0,
  );
  const [startTime, setStartTime] = useState(existing?.start_time ?? '10:00');
  const [endTime, setEndTime] = useState(existing?.end_time ?? '11:00');
  const [voiceNoteMediaId, setVoiceNoteMediaId] = useState<number | null>(
    existing?.voice_note_media_id ?? null,
  );
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
  const activeDuration = minutesBetween(startTime, endTime);

  function setStartToNow() {
    const now = nowIstClock();
    setStartTime(now);
    // Preserve the currently selected duration when the start time
    // slides, so tapping "Now" then "60 min" works the way you'd
    // expect and doesn't force you to re-pick the chip.
    const dur = activeDuration > 0 ? activeDuration : 60;
    setEndTime(addMinutes(now, dur));
  }
  function setDuration(mins: number) {
    setEndTime(addMinutes(startTime, mins));
  }

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
        voice_note_media_id: voiceNoteMediaId,
        marks: children.map((c) => ({
          student_id: c.id,
          present: marks[c.id] ?? false,
        })),
      });
      onSaved({ present: counts.present, total: counts.total });
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
        <div className="sm:col-span-2">
          <div className="flex flex-wrap items-end gap-3">
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
            <button
              type="button"
              onClick={setStartToNow}
              className="h-[38px] bg-card hover:bg-card-hover border border-border rounded px-3 text-sm"
            >
              {t('attendance.form.start_now')}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-fg">
              {t('attendance.form.duration')}
            </span>
            {DURATION_CHIPS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                aria-pressed={activeDuration === d}
                className={
                  'rounded-full px-3 py-1 text-xs border ' +
                  (activeDuration === d
                    ? 'bg-primary text-primary-fg border-primary'
                    : 'bg-card text-fg border-border hover:bg-card-hover')
                }
              >
                {t('attendance.form.duration_chip', { mins: d })}
              </button>
            ))}
            <label className="text-xs text-muted-fg ml-2">
              {t('attendance.form.end_time')}{' '}
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="bg-card text-fg border border-border rounded px-2 py-1 text-xs"
                required
              />
            </label>
          </div>
        </div>
      </div>

      <VoiceNoteRecorder
        villageId={villageId}
        value={voiceNoteMediaId}
        onChange={setVoiceNoteMediaId}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CountBadge
            variant="present"
            label={t('attendance.badge.present', { n: counts.present })}
          />
          <CountBadge
            variant="absent"
            label={t('attendance.badge.absent', { n: counts.total - counts.present })}
          />
          <span className="text-xs text-muted-fg">
            {t('attendance.badge.of', { total: counts.total })}
          </span>
        </div>
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
              <button
                type="button"
                onClick={() => toggleOne(c.id, !present)}
                aria-pressed={present}
                className={
                  'w-full min-h-[52px] p-3 flex items-center justify-between gap-3 text-left ' +
                  (present ? 'hover:bg-card-hover' : 'bg-danger/5 hover:bg-danger/10')
                }
              >
                <span className="font-medium">
                  {c.first_name} {c.last_name}
                </span>
                <span className="inline-flex items-center gap-2 text-sm">
                  <span className={present ? 'text-primary font-medium' : 'text-danger font-medium'}>
                    {present ? t('attendance.present') : t('attendance.absent')}
                  </span>
                  <span
                    aria-hidden="true"
                    className={
                      'inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs ' +
                      (present
                        ? 'bg-primary text-primary-fg border-primary'
                        : 'bg-card border-border text-muted-fg')
                    }
                  >
                    {present ? '✓' : ''}
                  </span>
                </span>
              </button>
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

// Village media gallery. Lists every committed media row attributed
// to this village (image + video + audio). Clicking a tile opens
// the raw bytes in a new tab — L2.4 has no thumbnail derivation yet
// (decisions.md D11), so thumb_url points at the original object.
function MediaTab({ villageId }: { villageId: number }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const canWrite = can(user, 'media.write');
  const [items, setItems] = useState<MediaWithUrls[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    api.media({ village_id: villageId })
      .then((r) => setItems(r.media))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [villageId]);

  useEffect(() => { load(); }, [load]);

  async function onDelete(id: number) {
    if (!confirm(t('media.delete.confirm'))) return;
    try {
      const res = await fetch(`/api/media/${id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  }

  if (items === null) return <p className="text-muted-fg">{t('common.loading')}</p>;
  if (err) return <p className="text-danger">{err}</p>;
  if (items.length === 0) {
    return <p className="text-muted-fg">{t('media.empty')}</p>;
  }

  return (
    <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((m) => (
        <li
          key={m.id}
          className="bg-card border border-border rounded overflow-hidden"
        >
          <a
            href={m.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block aspect-square bg-bg flex items-center justify-center text-xs text-muted-fg"
          >
            {m.kind === 'image' ? (
              <img src={m.thumb_url} alt="" className="w-full h-full object-cover" />
            ) : m.kind === 'video' ? (
              <span>{t('media.kind.video')}</span>
            ) : (
              <span>{t('media.kind.audio')}</span>
            )}
          </a>
          <div className="p-2 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-fg truncate">
              {new Date(m.captured_at * 1000).toLocaleString()}
            </span>
            {canWrite && (
              <button
                type="button"
                onClick={() => onDelete(m.id)}
                className="text-xs text-muted-fg hover:text-danger"
                aria-label={t('media.delete')}
              >
                ×
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
