import { useState } from 'react';
import { useAuth } from '../auth';
import { LANGS, useI18n } from '../i18n';
import { THEME_ORDER, useTheme } from '../theme';

export function Login() {
  const { login } = useAuth();
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useI18n();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

  const field =
    'mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus';

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-bg">
      <form
        onSubmit={submit}
        className="bg-card text-fg border border-border shadow rounded-lg p-6 w-full max-w-sm space-y-4"
      >
        <div className="flex flex-col items-center gap-2">
          <img src="/logo.png" alt="NavSahyog Foundation" className="w-28 h-28" />
          <h1 className="text-lg font-semibold text-primary">{t('app.name')}</h1>
        </div>
        {import.meta.env.DEV && (
          <p className="text-sm text-muted-fg text-center">
            {t('auth.login.hint', { creds: 'vc-anandpur / password' })}
          </p>
        )}
        <label className="block">
          <span className="text-sm">{t('auth.login.user_id')}</span>
          <input
            className={field}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm">{t('auth.login.password')}</span>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              className={field + ' pr-10'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword
                  ? t('auth.login.hide_password')
                  : t('auth.login.show_password')
              }
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-fg hover:text-fg focus:outline-none focus:ring-2 focus:ring-focus rounded"
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-primary hover:bg-primary-hover disabled:opacity-60 text-primary-fg rounded px-3 py-2"
        >
          {busy ? t('auth.login.submitting') : t('auth.login.submit')}
        </button>
        <div className="pt-2 border-t border-border space-y-3">
          <div>
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
          <div>
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
        </div>
      </form>
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

function EyeIcon() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z"
      />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3l14 14M8.2 5.3A8.7 8.7 0 0110 5c5.5 0 8.5 5 8.5 5a14 14 0 01-2.6 3.2M6.1 6.8A14 14 0 001.5 10s3 5 8.5 5a8.7 8.7 0 003.5-.7"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.2 8.3a2.5 2.5 0 003.5 3.5"
      />
    </svg>
  );
}
