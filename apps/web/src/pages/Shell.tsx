import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserMenu } from '../components/UserMenu';
import { useI18n } from '../i18n';
import { useAuth } from '../auth';
import { api, can, type StreakResponse } from '../api';

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { t } = useI18n();
  const { user } = useAuth();
  const [streak, setStreak] = useState<StreakResponse | null>(null);

  // Streak chip is only meaningful for write-tier roles that run
  // activities. Read-only district+ admins don't log sessions
  // themselves, so there's nothing to streak on.
  const canLog = can(user, 'attendance.write');
  // Masters tab is Super-Admin only (decisions.md D22). `user.write`
  // is in the SUPER_ADMIN_ONLY set, so checking it here is enough.
  const canMasters = can(user, 'user.write');
  // Ponds tab is everyone with `pond.read` — that's every
  // authenticated user today, but the cap is the gate so a future
  // role with no pond.read drops the link automatically.
  const canPonds = can(user, 'pond.read');

  useEffect(() => {
    if (!canLog) {
      setStreak(null);
      return;
    }
    let cancelled = false;
    api.streaks()
      .then((r) => { if (!cancelled) setStreak(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [canLog, pathname]);

  return (
    <div className="min-h-full flex flex-col bg-bg">
      <header className="bg-primary text-primary-fg shadow">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2.5 flex items-center gap-3 sm:gap-6">
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img
              src="/logo.png"
              alt=""
              className="w-9 h-9 sm:w-10 sm:h-10 bg-white rounded-full p-0.5 shrink-0"
            />
            <span className="font-semibold text-sm sm:text-base truncate">
              {t('app.name')}
            </span>
          </Link>
          <nav className="flex items-center gap-3 sm:gap-5 text-sm">
            <NavLink to="/" active={pathname === '/'}>
              {t('nav.home')}
            </NavLink>
            <NavLink to="/capture" active={pathname === '/capture'}>
              {t('nav.capture')}
            </NavLink>
            <NavLink to="/achievements" active={pathname === '/achievements'}>
              {t('nav.achievements')}
            </NavLink>
            <NavLink to="/dashboard" active={pathname === '/dashboard'}>
              {t('nav.dashboard')}
            </NavLink>
            {/* Secondary destinations: shown inline from sm: up where
                there's room; folded into the More menu on mobile. The
                same items are rendered twice — once inline (hidden on
                <sm) and once inside the dropdown (sm:hidden) — so the
                visible set never overflows the header band. */}
            {canPonds && (
              <NavLink
                to="/ponds"
                active={pathname.startsWith('/ponds')}
                className="hidden sm:inline"
              >
                {t('nav.ponds')}
              </NavLink>
            )}
            <NavLink
              to="/training-manuals"
              active={pathname === '/training-manuals'}
              className="hidden sm:inline"
            >
              {t('nav.manuals')}
            </NavLink>
            {canMasters && (
              <NavLink
                to="/masters"
                active={pathname.startsWith('/masters')}
                className="hidden sm:inline"
              >
                {t('nav.masters')}
              </NavLink>
            )}
            <MoreMenu
              pathname={pathname}
              canPonds={canPonds}
              canMasters={canMasters}
            />
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {streak && streak.current_streak_days > 0 && (
              <StreakChip streak={streak} />
            )}
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-5xl mx-auto p-3 sm:p-4">{children}</div>
      </main>
    </div>
  );
}

function StreakChip({ streak }: { streak: StreakResponse }) {
  const { t } = useI18n();
  // Flame glyph sized relative to the text; the small digit tucked
  // against it avoids a separate pill edge. Tooltip shows the best
  // streak so the chip rewards without bragging.
  const title = t('streak.tooltip', {
    best: streak.best_streak_days,
    thisWeek: streak.sessions_this_week,
  });
  return (
    <span
      title={title}
      className="hidden sm:inline-flex items-center gap-1 rounded-full bg-white/15 text-primary-fg px-2.5 py-1 text-xs font-medium"
    >
      <span aria-hidden="true">🔥</span>
      <span>
        {t('streak.label', { days: streak.current_streak_days })}
      </span>
    </span>
  );
}

function NavLink({
  to,
  active,
  className,
  children,
}: {
  to: string;
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  const base =
    'py-1 ' +
    (active
      ? 'underline underline-offset-4 font-medium'
      : 'opacity-85 hover:opacity-100');
  return (
    <Link to={to} className={className ? `${base} ${className}` : base}>
      {children}
    </Link>
  );
}

// Mobile-only "More" overflow menu. Holds secondary nav items that
// would otherwise wrap or push the user-menu off the right edge on a
// 360 px-wide phone. On sm: and above the inline links are visible, so
// this whole control hides — keeping fast keyboard/desktop navigation
// unchanged.
function MoreMenu({
  pathname,
  canPonds,
  canMasters,
}: {
  pathname: string;
  canPonds: boolean;
  canMasters: boolean;
}) {
  const { t } = useI18n();
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

  // Close after a tap so the menu doesn't linger over the destination
  // page. The Link's navigation runs first, then this fires.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Active highlight on the trigger when one of the folded routes is
  // current — same underline treatment the inline links use.
  const activeFolded =
    pathname.startsWith('/ponds') ||
    pathname === '/training-manuals' ||
    pathname.startsWith('/masters');

  return (
    <div ref={ref} className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          'py-1 inline-flex items-center gap-1 ' +
          (activeFolded
            ? 'underline underline-offset-4 font-medium'
            : 'opacity-85 hover:opacity-100')
        }
      >
        {t('nav.more')}
        <svg
          className="w-3.5 h-3.5"
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
          className="absolute left-0 mt-2 w-48 bg-card text-fg border border-border rounded-lg shadow-lg overflow-hidden z-20"
        >
          {canPonds && (
            <MoreItem
              to="/ponds"
              active={pathname.startsWith('/ponds')}
              label={t('nav.ponds')}
            />
          )}
          <MoreItem
            to="/training-manuals"
            active={pathname === '/training-manuals'}
            label={t('nav.manuals')}
          />
          {canMasters && (
            <MoreItem
              to="/masters"
              active={pathname.startsWith('/masters')}
              label={t('nav.masters')}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MoreItem({
  to,
  active,
  label,
}: {
  to: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      className={
        'block px-4 py-2.5 text-sm hover:bg-card-hover ' +
        (active ? 'font-medium bg-card-hover' : '')
      }
    >
      {label}
    </Link>
  );
}
