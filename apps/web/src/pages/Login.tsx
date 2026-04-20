import { useState } from 'react';
import { useAuth } from '../auth';
import { THEME_LABELS, THEME_ORDER, useTheme } from '../theme';

export function Login() {
  const { login } = useAuth();
  const { theme, setTheme } = useTheme();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(userId, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-bg">
      <form
        onSubmit={submit}
        className="bg-card text-fg border border-border shadow rounded-lg p-6 w-full max-w-sm space-y-4"
      >
        <div className="flex flex-col items-center gap-2">
          <img src="/logo.png" alt="NavSahyog Foundation" className="w-28 h-28" />
          <h1 className="text-lg font-semibold text-primary">NavSahyog ERP</h1>
        </div>
        <p className="text-sm text-muted-fg text-center">
          Lab build — L1. Try <code>vc-anandpur</code> / <code>password</code>.
        </p>
        <label className="block">
          <span className="text-sm">User ID</span>
          <input
            className="mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm">Password</span>
          <input
            type="password"
            className="mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-3 py-2"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="pt-2 border-t border-border">
          <div className="text-xs font-medium text-muted-fg mb-2">Theme</div>
          <div className="grid grid-cols-3 gap-1">
            {THEME_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                className={
                  'rounded px-2 py-1.5 text-xs border ' +
                  (theme === t
                    ? 'bg-primary text-primary-fg border-primary'
                    : 'bg-card text-fg border-border hover:bg-card-hover')
                }
              >
                {THEME_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
