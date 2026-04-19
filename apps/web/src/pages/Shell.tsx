import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-emerald-700 text-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-6">
          <Link to="/" className="font-semibold">NavSahyog ERP</Link>
          <nav className="flex gap-4 text-sm">
            <Link
              to="/"
              className={pathname === '/' ? 'underline' : 'opacity-80 hover:opacity-100'}
            >
              Home
            </Link>
            <Link
              to="/dashboard"
              className={pathname === '/dashboard' ? 'underline' : 'opacity-80 hover:opacity-100'}
            >
              Dashboard
            </Link>
          </nav>
          <div className="ml-auto text-sm flex items-center gap-3">
            <span className="opacity-80">{user?.full_name} · {user?.role}</span>
            <button
              className="bg-white/10 hover:bg-white/20 rounded px-2 py-1"
              onClick={() => { void logout(); }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-5xl mx-auto p-4">{children}</div>
      </main>
    </div>
  );
}
