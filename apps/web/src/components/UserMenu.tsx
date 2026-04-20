import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { LANGS, useI18n, type Lang } from '../i18n';
import { THEME_ORDER, useTheme } from '../theme';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 text-primary-fg px-2 py-1"
      >
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/25 text-sm font-semibold">
          {initials(user.full_name)}
        </span>
        <span className="hidden sm:inline text-sm">{user.full_name}</span>
        <svg
          className="w-4 h-4 hidden sm:inline"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 bg-card text-fg border border-border rounded-lg shadow-lg overflow-hidden z-20"
        >
          <div className="px-4 py-3 border-b border-border">
            <div className="font-semibold">{user.full_name}</div>
            <div className="text-xs text-muted-fg">
              {t(`role.${user.role}`)} · {user.user_id}
            </div>
          </div>
          <div className="px-4 py-3 border-b border-border">
            <div className="text-xs font-medium text-muted-fg mb-2">
              {t('common.theme')}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {THEME_ORDER.map((th) => (
                <Pill
                  key={th}
                  label={t(`theme.${th}`)}
                  active={theme === th}
                  onClick={() => setTheme(th)}
                />
              ))}
            </div>
          </div>
          <div className="px-4 py-3 border-b border-border">
            <div className="text-xs font-medium text-muted-fg mb-2">
              {t('common.language')}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {LANGS.map((l) => (
                <Pill
                  key={l}
                  label={t(`lang.${l}`)}
                  active={lang === l}
                  onClick={() => setLang(l)}
                />
              ))}
            </div>
          </div>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); void logout(); }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-card-hover"
          >
            {t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

function Pill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded px-2 py-1.5 text-xs border ' +
        (active
          ? 'bg-primary text-primary-fg border-primary'
          : 'bg-card text-fg border-border hover:bg-card-hover')
      }
    >
      {label}
    </button>
  );
}
