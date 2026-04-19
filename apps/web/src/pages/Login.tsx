import { useState } from 'react';
import { useAuth } from '../auth';

export function Login() {
  const { login } = useAuth();
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
    <div className="min-h-full flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="bg-white shadow rounded-lg p-6 w-full max-w-sm space-y-4"
      >
        <h1 className="text-xl font-semibold text-emerald-800">NavSahyog ERP</h1>
        <p className="text-sm text-slate-500">
          Lab build — L1. Try <code>vc-anandpur</code> / <code>password</code>.
        </p>
        <label className="block">
          <span className="text-sm text-slate-700">User ID</span>
          <input
            className="mt-1 w-full border rounded px-2 py-1.5"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-700">Password</span>
          <input
            type="password"
            className="mt-1 w-full border rounded px-2 py-1.5"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white rounded px-3 py-2"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
