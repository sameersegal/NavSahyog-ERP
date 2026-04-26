import { useEffect, useState, type ReactNode } from 'react';
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
          <nav className="flex gap-3 sm:gap-5 text-sm">
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
            <NavLink
              to="/training-manuals"
              active={pathname === '/training-manuals'}
            >
              {t('nav.manuals')}
            </NavLink>
            {canMasters && (
              <NavLink to="/masters" active={pathname === '/masters'}>
                {t('nav.masters')}
              </NavLink>
            )}
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
  children,
}: {
  to: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={
        'py-1 ' +
        (active
          ? 'underline underline-offset-4 font-medium'
          : 'opacity-85 hover:opacity-100')
      }
    >
      {children}
    </Link>
  );
}
