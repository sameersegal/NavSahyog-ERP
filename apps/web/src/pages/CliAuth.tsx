import { useEffect, useMemo, useState } from 'react';
import { SignIn, useAuth as useClerkAuth, useUser } from '@clerk/clerk-react';
import { useI18n } from '../i18n';

// CLI / agent auth bridge. The companion piece is `scripts/nsf-auth.mjs`,
// which spins up a one-shot loopback HTTP listener, opens the operator's
// browser to this page with `?return_to=http://127.0.0.1:<port>/callback`
// and a CSRF `state`, and waits.
//
// Once the operator is signed in to Clerk (via the embedded `<SignIn />`
// widget, identical to /login), we mint a Clerk session JWT via
// `getToken()` and redirect to the loopback URL with the JWT in the
// query string. The CLI captures it, calls `/auth/exchange` itself, and
// persists the resulting `nsf_session` cookie to `~/.nsf/credentials`.
//
// Threat model:
//   * Open redirect — `return_to` is whitelisted to loopback only
//     (127.0.0.1 / [::1] / localhost) so this page can't be used to
//     bounce a victim's Clerk JWT to an attacker-controlled host.
//   * CSRF — the `state` value is echoed back unchanged so the CLI
//     can refuse callbacks it didn't initiate.
//   * JWT lifetime — Clerk's default session JWT TTL is ~1 minute;
//     even if the URL leaks into browser history, the token is
//     expired before anyone can replay it. The downstream
//     `nsf_session` cookie never crosses this page.

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function parseReturnTo(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;
  return url;
}

export function CliAuth() {
  const { t } = useI18n();
  const params = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const returnTo = useMemo(() => parseReturnTo(params.get('return_to')), [params]);
  const state = params.get('state') ?? '';

  const { isLoaded: clerkLoaded, isSignedIn } = useUser();
  const { getToken } = useClerkAuth();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!clerkLoaded || !isSignedIn || !returnTo || redirecting) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('clerk getToken returned null');
        if (cancelled) return;
        const target = new URL(returnTo.toString());
        target.searchParams.set('clerk_jwt', token);
        if (state) target.searchParams.set('state', state);
        setRedirecting(true);
        window.location.replace(target.toString());
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message ?? 'failed to mint clerk token');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clerkLoaded, isSignedIn, getToken, returnTo, state, redirecting]);

  if (!returnTo) {
    return (
      <div className="min-h-full flex items-center justify-center p-4 bg-bg">
        <div className="bg-card text-fg border border-border shadow rounded-lg p-6 w-full max-w-sm space-y-3">
          <h1 className="text-lg font-semibold text-primary">CLI sign-in</h1>
          <p className="text-sm text-muted-fg">
            Missing or invalid <code>return_to</code>. This page is only
            reachable from the <code>nsf-auth</code> CLI helper. Run{' '}
            <code>node scripts/nsf-auth.mjs</code> from your terminal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-bg">
      <div className="bg-card text-fg border border-border shadow rounded-lg p-6 w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-2">
          <img src="/logo.png" alt="NavSahyog Foundation" className="w-20 h-20" />
          <h1 className="text-lg font-semibold text-primary">{t('app.name')}</h1>
          <p className="text-xs text-muted-fg text-center">CLI sign-in</p>
        </div>
        {!clerkLoaded ? (
          <p className="text-sm text-muted-fg text-center">Loading…</p>
        ) : isSignedIn ? (
          <p className="text-sm text-muted-fg text-center">
            {redirecting
              ? 'Returning to your terminal…'
              : 'Minting CLI token…'}
          </p>
        ) : (
          <div className="flex justify-center">
            <SignIn
              routing="hash"
              signUpUrl={undefined}
              appearance={{ elements: { footer: { display: 'none' } } }}
            />
          </div>
        )}
        {error && (
          <p className="text-sm text-danger text-center" role="alert">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-fg text-center">
          Returning to <code className="break-all">{returnTo.toString()}</code>
        </p>
      </div>
    </div>
  );
}
