import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserMenu } from '../components/UserMenu';
import { useI18n } from '../i18n';

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { t } = useI18n();
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
          </nav>
          <div className="ml-auto">
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
