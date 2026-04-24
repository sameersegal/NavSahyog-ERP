// Capture page — one-off media captures outside the child / attendance
// forms. Spec §3.4.
//
// Scope split (§3.4.3):
//   * VC: village is implicit (the single village they own).
//   * AF+: village is picked explicitly at upload time because the
//     role covers multiple villages.
// Instead of a modal dialog at submit time, we surface the picker
// inline — AFs see a dropdown, VCs see a disabled label with their
// village. Simpler, and both roles see the same page.
//
// Tag (§3.4.2): exactly one of event / activity / untagged. The
// server's `event` table collapses both (kind='event' | 'activity',
// migration 0004), so the UI exposes a grouped select.
//
// MediaRecorder handles video + audio; `<input type=file>` with
// capture=environment handles photos (camera on mobile, file chooser
// on desktop). No transcode (decisions.md D8) — the 50 MiB cap
// catches anything too big.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  api,
  can,
  type Event,
  type MediaKind,
  type MediaWithUrls,
  type Village,
} from '../api';
import {
  canonicalMime,
  captureGps,
  MAX_UPLOAD_BYTES,
  uploadMedia,
} from '../lib/media';
import { absoluteTime, relativeTime } from '../lib/date';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

const FIELD =
  'mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus';

export function Capture() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [villages, setVillages] = useState<Village[] | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [villageId, setVillageId] = useState<number | null>(null);
  const [kind, setKind] = useState<MediaKind>('image');
  const [tagEventId, setTagEventId] = useState<number | null>(null);
  const [recent, setRecent] = useState<MediaWithUrls[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // AFs and above pick the village; VCs have a single village that's
  // set automatically. The UI pattern is the same for everyone — a
  // <select>, possibly one-item + disabled for VCs — so there's no
  // role branching in the render.
  const canWrite = can(user, 'media.write');

  useEffect(() => {
    api.villages().then((r) => {
      setVillages(r.villages);
      if (r.villages.length > 0 && villageId === null) {
        setVillageId(r.villages[0]!.id);
      }
    });
    api.events().then((r) => setEvents(r.events));
  }, [villageId]);

  const loadRecent = useCallback(() => {
    if (villageId === null) return;
    api.media({ village_id: villageId })
      .then((r) => setRecent(r.media.slice(0, 8)))
      .catch(() => setRecent([]));
  }, [villageId]);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const flashTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  async function onUploaded() {
    setFlash(t('capture.success'));
    // Clear the flash after a beat so repeated captures don't stack
    // messages. 3s matches the old attendance save toast. Cancel any
    // in-flight timer so a quick second upload doesn't dismiss the
    // new flash early, and so the timer doesn't fire after unmount.
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      setFlash(null);
      flashTimerRef.current = null;
    }, 3_000);
    loadRecent();
  }

  function handleError(e: unknown) {
    setErr(e instanceof Error ? e.message : t('media.error.failed'));
  }

  if (villages === null) {
    return <p className="text-muted-fg">{t('common.loading')}</p>;
  }
  if (villages.length === 0) {
    return <p className="text-muted-fg">{t('capture.empty_scope')}</p>;
  }

  const tagSelection: { group: 'event' | 'activity'; label: string; items: Event[] }[] = [
    { group: 'event',    label: t('capture.form.event'),    items: events.filter((e) => e.kind === 'event') },
    { group: 'activity', label: t('capture.form.activity'), items: events.filter((e) => e.kind === 'activity') },
  ];

  const singleVillage = villages.length === 1;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('capture.title')}</h1>

      <div className="bg-card border border-border rounded p-4 space-y-4">
        {/* Kind selector as segmented buttons — photo / video / audio.
            Three big touch targets are faster than a dropdown in the
            field, and the icons make the choice legible at a glance. */}
        <div>
          <div className="text-xs text-muted-fg uppercase tracking-wide mb-1.5">
            {t('capture.form.kind')}
          </div>
          <div
            role="radiogroup"
            aria-label={t('capture.form.kind')}
            className="inline-flex rounded-lg border border-border overflow-hidden"
          >
            {(['image', 'video', 'audio'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={
                  'px-4 py-2 text-sm min-w-[84px] flex items-center justify-center gap-1.5 border-r border-border last:border-r-0 ' +
                  (kind === k
                    ? 'bg-primary text-primary-fg'
                    : 'bg-card text-fg hover:bg-card-hover')
                }
              >
                <span aria-hidden="true">
                  {k === 'image' ? '📷' : k === 'video' ? '🎬' : '🎙'}
                </span>
                {t(`capture.form.kind.${k}`)}
              </button>
            ))}
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-3 ${singleVillage ? 'sm:grid-cols-1' : 'sm:grid-cols-2'}`}>
          {/* Village picker. For single-village users the dropdown is
              useless noise — we show a read-only chip instead. */}
          {singleVillage ? (
            <div>
              <div className="text-xs text-muted-fg uppercase tracking-wide mb-1">
                {t('capture.form.village')}
              </div>
              <div className="inline-flex items-center gap-2 bg-card-hover border border-border rounded px-3 py-1.5 text-sm">
                <span aria-hidden="true">📍</span>
                <span className="font-medium">{villages[0]?.name}</span>
              </div>
            </div>
          ) : (
            <label className="block">
              <span className="text-sm">{t('capture.form.village')}</span>
              <select
                className={FIELD}
                value={villageId ?? ''}
                onChange={(e) => setVillageId(Number(e.target.value))}
              >
                {villages.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-sm">{t('capture.form.tag')}</span>
            <select
              className={FIELD}
              value={tagEventId ?? ''}
              onChange={(e) => setTagEventId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t('capture.form.none')}</option>
              {tagSelection.map((group) =>
                group.items.length === 0 ? null : (
                  <optgroup key={group.group} label={group.label}>
                    {group.items.map((ev) => (
                      <option key={ev.id} value={ev.id}>{ev.name}</option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </label>
        </div>

        {!canWrite ? (
          <p className="text-sm text-muted-fg">
            {/* Same 403-by-construction story as the Achievements page:
                read-only tiers (district+ admin) can view the gallery
                but not upload. */}
            {t('capture.empty_scope')}
          </p>
        ) : villageId === null ? null : kind === 'image' ? (
          <PhotoCapture
            villageId={villageId}
            tagEventId={tagEventId}
            onUploaded={onUploaded}
            onError={handleError}
          />
        ) : kind === 'audio' ? (
          <AudioCapture
            villageId={villageId}
            tagEventId={tagEventId}
            onUploaded={onUploaded}
            onError={handleError}
          />
        ) : (
          <VideoCapture
            villageId={villageId}
            tagEventId={tagEventId}
            onUploaded={onUploaded}
            onError={handleError}
          />
        )}

        {err && <p className="text-sm text-danger">{err}</p>}
      </div>

      {flash && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-card text-fg border border-border shadow-lg rounded-lg px-4 py-2 text-sm"
        >
          <span aria-hidden="true" className="text-primary">✓</span>
          <span>{flash}</span>
          <button
            type="button"
            onClick={() => {
              if (flashTimerRef.current !== null) {
                window.clearTimeout(flashTimerRef.current);
                flashTimerRef.current = null;
              }
              setFlash(null);
            }}
            aria-label={t('common.dismiss')}
            className="ml-2 text-muted-fg hover:text-fg"
          >
            <span aria-hidden="true" className="text-lg leading-none">×</span>
          </button>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('capture.recent')}</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-fg">{t('media.empty')}</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {recent.map((m) => (
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
                    <img
                      src={m.thumb_url}
                      alt={t('media.alt', {
                        kind: t('media.kind.image'),
                        when: absoluteTime(m.captured_at, lang),
                      })}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{t(`media.kind.${m.kind}` as const)}</span>
                  )}
                </a>
                <div
                  className="p-2 text-xs text-muted-fg truncate"
                  title={absoluteTime(m.captured_at, lang)}
                >
                  {relativeTime(m.captured_at, lang)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---- per-kind capture components ----------------------------------

type Sub = {
  villageId: number;
  tagEventId: number | null;
  onUploaded: () => void;
  onError: (e: unknown) => void;
};

function PhotoCapture({ villageId, tagEventId, onUploaded, onError }: Sub) {
  const { t } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: File; previewUrl: string } | null>(null);

  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.previewUrl);
    };
  }, [pending]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      onError(new Error(t('media.error.too_big')));
      return;
    }
    setPending({ file, previewUrl: URL.createObjectURL(file) });
  }

  function retake() {
    // The useEffect cleanup on [pending] handles URL.revokeObjectURL
    // when the old pending slot is replaced with null.
    setPending(null);
    ref.current?.click();
  }

  async function upload() {
    if (!pending) return;
    setBusy(true);
    try {
      const gps = await captureGps();
      await uploadMedia({
        file: pending.file,
        kind: 'image',
        mime: canonicalMime(pending.file.type) || 'image/jpeg',
        villageId,
        gps,
        tagEventId,
      });
      setPending(null);
      onUploaded();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFile}
      />
      {pending ? (
        <>
          <img
            src={pending.previewUrl}
            alt={t('capture.preview.alt')}
            className="w-full max-h-80 object-contain rounded bg-bg"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={upload}
              disabled={busy}
              className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-4 py-2 text-sm min-h-[44px]"
            >
              {busy ? t('media.uploading') : t('capture.action.upload')}
            </button>
            <button
              type="button"
              onClick={retake}
              disabled={busy}
              className="bg-card hover:bg-card-hover text-fg border border-border rounded px-4 py-2 text-sm min-h-[44px]"
            >
              {t('capture.action.retake')}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-4 py-2 text-sm min-h-[44px]"
        >
          {t('capture.action.pick')}
        </button>
      )}
    </div>
  );
}

function AudioCapture(props: Sub) {
  return <RecordingCapture {...props} mode="audio" />;
}
function VideoCapture(props: Sub) {
  return <RecordingCapture {...props} mode="video" />;
}

// Shared MediaRecorder wrapper for audio + video. Records directly to
// a Blob, uploads on stop. Bypasses the 50 MiB cap at the client
// level only by stopping the recorder when the blob approaches it —
// the onstop handler still verifies before upload.
function RecordingCapture({
  villageId,
  tagEventId,
  onUploaded,
  onError,
  mode,
}: Sub & { mode: 'audio' | 'video' }) {
  const { t } = useI18n();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState<{ blob: Blob; mime: string; previewUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
  }, []);

  // Revoke the preview object URL on unmount / change so the
  // blob can be freed.
  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.previewUrl);
    };
  }, [pending]);

  // Re-bind the live video preview when the stream changes. Must
  // live in an effect (not directly in start()) because the <video>
  // isn't mounted until after setRecording(true) re-renders.
  useEffect(() => {
    if (mode === 'video' && recording && videoPreviewRef.current && streamRef.current) {
      videoPreviewRef.current.srcObject = streamRef.current;
      videoPreviewRef.current.play().catch(() => {});
    }
  }, [recording, mode]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        mode === 'audio' ? { audio: true } : { audio: true, video: { facingMode: 'environment' } },
      );
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const mime = canonicalMime(rec.mimeType) ||
          (mode === 'audio' ? 'audio/webm' : 'video/webm');
        const blob = new Blob(chunksRef.current, { type: mime });
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        chunksRef.current = [];
        if (blob.size > MAX_UPLOAD_BYTES) {
          onError(new Error(t('media.error.too_big')));
          return;
        }
        setPending({ blob, mime, previewUrl: URL.createObjectURL(blob) });
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
    } catch (e) {
      onError(e instanceof Error ? e : new Error(t('media.error.mic_denied')));
    }
  }

  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  function retake() {
    // The useEffect cleanup on [pending] handles URL.revokeObjectURL
    // when the old pending slot is replaced with null.
    setPending(null);
  }

  async function upload() {
    if (!pending) return;
    setBusy(true);
    try {
      const gps = await captureGps();
      await uploadMedia({
        file: pending.blob,
        kind: mode,
        mime: pending.mime,
        villageId,
        gps,
        tagEventId,
      });
      setPending(null);
      onUploaded();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const actionLabel = mode === 'audio'
    ? t('capture.action.record_audio')
    : t('capture.action.record_video');

  return (
    <div className="space-y-3">
      {mode === 'video' && recording && (
        <video
          ref={videoPreviewRef}
          muted
          playsInline
          className="w-full max-h-80 bg-black rounded"
        />
      )}
      {pending && !recording && mode === 'audio' && (
        <audio src={pending.previewUrl} controls className="h-8" />
      )}
      {pending && !recording && mode === 'video' && (
        <video src={pending.previewUrl} controls className="w-full max-h-80 rounded" />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {recording ? (
          <button
            type="button"
            onClick={stop}
            className="bg-danger text-primary-fg rounded px-4 py-2 text-sm min-h-[44px]"
          >
            {t('attendance.form.voice_note.stop', { s: elapsed })}
          </button>
        ) : pending ? (
          <>
            <button
              type="button"
              onClick={upload}
              disabled={busy}
              className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-4 py-2 text-sm min-h-[44px]"
            >
              {busy ? t('media.uploading') : t('capture.action.upload')}
            </button>
            <button
              type="button"
              onClick={retake}
              disabled={busy}
              className="bg-card hover:bg-card-hover text-fg border border-border rounded px-4 py-2 text-sm min-h-[44px]"
            >
              {t('capture.action.retake')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-4 py-2 text-sm min-h-[44px]"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
