// Outbox UI (L4.0b — decisions.md D29, D32; level-4.md "Working
// principles" rules 5 + 8).
//
// The user-facing screen for the device-local mutation queue: lists
// every row by status, exposes per-item retry / discard, and a
// manual "Sync now" button. Wires onto the existing platform
// (lib/outbox.ts + lib/drain.ts + SyncStateProvider).
//
// L4.0b ships the screen with no live workflows feeding it. L4.1+
// will start enqueueing real attendance / achievement / media
// mutations; the screen renders them as-is the moment they appear.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n, type Lang } from '../i18n';
import { useSyncState } from '../lib/sync-state';
import {
  OUTBOX_CHANGED_EVENT,
  discard as outboxDiscard,
  listAll,
  retry as outboxRetry,
} from '../lib/outbox';
import type { OutboxRow, OutboxStatus } from '@navsahyog/shared';

function formatTimestamp(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(lang, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

const STATUS_ORDER: readonly OutboxStatus[] = [
  'in_flight',
  'pending',
  'failed',
  'dead_letter',
  'done',
];

const STATUS_PILL: Record<OutboxStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  in_flight: 'bg-sky-100 text-sky-900',
  failed: 'bg-rose-100 text-rose-900',
  dead_letter: 'bg-rose-200 text-rose-950',
  done: 'bg-emerald-100 text-emerald-900',
};

export function Outbox() {
  const { t } = useI18n();
  const { state, network, outbox, syncNow } = useSyncState();
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const all = await listAll();
    setRows(all);
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    window.addEventListener(OUTBOX_CHANGED_EVENT, handler);
    return () => window.removeEventListener(OUTBOX_CHANGED_EVENT, handler);
  }, [refresh]);

  const grouped = useMemo(() => {
    const buckets: Record<OutboxStatus, OutboxRow[]> = {
      pending: [],
      in_flight: [],
      failed: [],
      dead_letter: [],
      done: [],
    };
    for (const row of rows) buckets[row.status].push(row);
    return buckets;
  }, [rows]);

  const onSyncNow = async () => {
    setBusy(true);
    try {
      await syncNow();
    } finally {
      setBusy(false);
    }
  };

  const onRetry = async (key: string) => {
    await outboxRetry(key);
    await syncNow();
  };

  const onDiscard = async (key: string) => {
    if (!window.confirm(t('outbox.discard.confirm'))) return;
    await outboxDiscard(key);
  };

  const total =
    outbox.pending + outbox.in_flight + outbox.failed + outbox.dead_letter;
  const empty = rows.length === 0;

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold">{t('outbox.title')}</h1>
          <p className="text-sm text-muted-fg">{t('outbox.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={onSyncNow}
          disabled={busy || network === 'offline' || state === 'update_required'}
          className="shrink-0 rounded bg-primary text-primary-fg px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? t('outbox.syncing') : t('outbox.sync_now')}
        </button>
      </header>

      <div
        role="status"
        className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm"
      >
        <Stat label={t('outbox.stat.pending')} n={outbox.pending} />
        <Stat label={t('outbox.stat.in_flight')} n={outbox.in_flight} />
        <Stat label={t('outbox.stat.failed')} n={outbox.failed} />
        <Stat label={t('outbox.stat.dead_letter')} n={outbox.dead_letter} />
      </div>

      {empty ? (
        <p className="text-sm text-muted-fg italic py-6">
          {t('outbox.empty')}
        </p>
      ) : (
        STATUS_ORDER.map((status) => {
          const bucket = grouped[status];
          if (bucket.length === 0) return null;
          return (
            <section key={status} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
                {t(`outbox.section.${status}`)} ({bucket.length})
              </h2>
              <ul className="divide-y divide-border rounded border border-border overflow-hidden">
                {bucket.map((row) => (
                  <Row
                    key={row.idempotency_key}
                    row={row}
                    onRetry={onRetry}
                    onDiscard={onDiscard}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {total === 0 && rows.length > 0 && (
        <p className="text-xs text-muted-fg italic">
          {t('outbox.all_done_hint')}
        </p>
      )}
    </div>
  );
}

function Stat({ label, n }: { label: string; n: number }) {
  return (
    <div className="rounded border border-border bg-card px-3 py-2">
      <div className="text-xs text-muted-fg">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{n}</div>
    </div>
  );
}

function Row({
  row,
  onRetry,
  onDiscard,
}: {
  row: OutboxRow;
  onRetry: (key: string) => void;
  onDiscard: (key: string) => void;
}) {
  const { t, lang } = useI18n();
  const created = formatTimestamp(row.created_at, lang);
  const canRetry = row.status === 'failed' || row.status === 'dead_letter';
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Bundle the row into a support-ticket-friendly JSON snippet. The
  // user opens a dead-letter row, hits "Copy", and pastes into a
  // ticket; this gives the support team everything they need to
  // reproduce — idempotency key, endpoint shape, the build that
  // authored the row, and the rejection reason.
  const supportBundle = useMemo(
    () =>
      JSON.stringify(
        {
          idempotency_key: row.idempotency_key,
          status: row.status,
          method: row.method,
          path: row.path,
          schema_version: row.schema_version,
          build_id: row.build_id,
          attempts: row.attempts,
          created_at: new Date(row.created_at).toISOString(),
          last_error: row.last_error,
          body: row.body,
        },
        null,
        2,
      ),
    [row],
  );

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(supportBundle);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-secure contexts. Fall back
      // to a synthetic textarea + execCommand. Best effort —
      // worst case the user has to read the expanded panel.
      const ta = document.createElement('textarea');
      ta.value = supportBundle;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  return (
    <li className="px-3 py-2 space-y-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={
                'rounded px-1.5 py-0.5 text-xs font-medium ' +
                STATUS_PILL[row.status]
              }
            >
              {t(`outbox.status.${row.status}`)}
            </span>
            <code className="text-xs text-muted-fg truncate">
              {row.method} {row.path}
            </code>
          </div>
          <div className="text-xs text-muted-fg mt-1">
            {t('outbox.row.meta', {
              when: created,
              attempts: row.attempts,
              build: row.build_id,
              schema: row.schema_version,
            })}
          </div>
          {row.last_error && (
            <div className="text-xs text-rose-700 mt-1 break-words">
              {row.last_error}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="text-xs rounded border border-border px-2 py-1 hover:bg-bg"
          >
            {expanded ? t('outbox.action.hide') : t('outbox.action.show')}
          </button>
          {canRetry && (
            <button
              type="button"
              onClick={() => onRetry(row.idempotency_key)}
              className="text-xs rounded border border-border px-2 py-1 hover:bg-bg"
            >
              {t('outbox.action.retry')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDiscard(row.idempotency_key)}
            className="text-xs rounded border border-border px-2 py-1 text-rose-700 hover:bg-rose-50"
          >
            {t('outbox.action.discard')}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="rounded border border-border bg-bg/40 p-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-fg">
              {t('outbox.row.payload_label')}
            </span>
            <button
              type="button"
              onClick={onCopy}
              className="text-xs rounded border border-border px-2 py-1 hover:bg-bg"
            >
              {copied ? t('outbox.action.copied') : t('outbox.action.copy')}
            </button>
          </div>
          <pre className="text-xs whitespace-pre-wrap break-words font-mono leading-snug max-h-64 overflow-auto">
            {supportBundle}
          </pre>
        </div>
      )}
    </li>
  );
}
