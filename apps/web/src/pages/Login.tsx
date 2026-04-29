import { SignIn } from '@clerk/clerk-react';
import { LANGS, useI18n } from '../i18n';
import { THEME_ORDER, useTheme } from '../theme';

// D36 step 4 — sign-in is Clerk's hosted widget, embedded here so
// the existing pre-sign-in chrome (logo, theme + language pickers)
// stays as the field-staff onboarding experience. Clerk's widget
// uses hash routing so we don't have to expose its internal
// sub-routes (SSO callback, factor pickers, etc.) through
// react-router. Sign-up is intentionally not offered — admins
// provision users in the Clerk dashboard; locked down with
// "Restricted" sign-up mode in Clerk's dashboard settings.

export function Login() {
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useI18n();

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-bg">
      <div className="bg-card text-fg border border-border shadow rounded-lg p-6 w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-2">
          <img src="/logo.png" alt="NavSahyog Foundation" className="w-28 h-28" />
          <h1 className="text-lg font-semibold text-primary">{t('app.name')}</h1>
        </div>
        <div className="flex justify-center">
          <SignIn
            routing="hash"
            signUpUrl={undefined}
            appearance={{ elements: { footer: { display: 'none' } } }}
          />
        </div>
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
      </div>
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
