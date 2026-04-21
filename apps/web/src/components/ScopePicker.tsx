import { useEffect, useRef, useState } from 'react';
import { api, type GeoLevel, type GeoSearchHit } from '../api';
import { useI18n } from '../i18n';

// L2.5.2 — typeahead over villages + clusters in the caller's
// scope. Selection lifts a (level, id, name) tuple to the parent,
// which drives the URL-backed scope via Dashboard's `updateUrl`.
// The input debounces at 220ms — short enough to feel live, long
// enough to swallow every-keystroke fetches on slow networks.

type Props = {
  onPick: (hit: GeoSearchHit) => void;
};

const DEBOUNCE_MS = 220;
const MIN_QUERY = 2;

export function ScopePicker({ onPick }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search. Cancels the previous fetch by tracking the
  // latest query string; a stale callback that finishes after a
  // newer one has started writes nothing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(() => {
      let cancelled = false;
      api
        .geoSearch(q)
        .then((r) => { if (!cancelled) setResults(r.results); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Click-outside dismisses the popover. Keyboard Esc handled on
  // the input.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function onSelect(hit: GeoSearchHit) {
    onPick(hit);
    setQuery('');
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  }

  const q = query.trim();
  const showHint = open && q.length > 0 && q.length < MIN_QUERY;
  const showEmpty = open && q.length >= MIN_QUERY && !loading && results.length === 0;

  return (
    <div ref={wrapRef} className="relative w-full">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery('');
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        placeholder={t('dashboard.scope_search.placeholder')}
        aria-label={t('dashboard.scope_search.placeholder')}
        className="w-full bg-card text-fg border border-border rounded px-3 py-2 min-h-[44px] text-sm"
      />
      {open && (q.length > 0 || loading) && (
        <div
          role="listbox"
          className="absolute z-20 mt-1 w-full bg-card border border-border rounded shadow-lg max-h-[320px] overflow-auto"
        >
          {showHint && (
            <div className="px-3 py-2 text-xs text-muted-fg">
              {t('dashboard.scope_search.hint_min', { n: MIN_QUERY })}
            </div>
          )}
          {loading && q.length >= MIN_QUERY && (
            <div className="px-3 py-2 text-xs text-muted-fg">
              {t('common.loading')}
            </div>
          )}
          {!loading && results.length > 0 && (
            <ul className="divide-y divide-border">
              {results.map((hit) => (
                <li key={`${hit.level}-${hit.id}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(hit)}
                    className="w-full text-left px-3 py-2 min-h-[44px] hover:bg-card-hover flex flex-col gap-0.5"
                  >
                    <span className="text-sm font-medium">
                      {hit.name}
                    </span>
                    <span className="text-xs text-muted-fg">
                      {t(`dashboard.scope_search.level.${hit.level}`)}
                      {hit.path ? ` · ${hit.path}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showEmpty && (
            <div className="px-3 py-2 text-xs text-muted-fg">
              {t('dashboard.scope_search.empty')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
