import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth as useClerkAuth, useUser } from '@clerk/clerk-react';
import { api, type User } from './api';
import { wipeCache } from './lib/cache';
import { pullManifest } from './lib/manifest';

// D36: identity (whether you're signed in, password reset, MFA) is
// Clerk's job; authorization (role, scope, capabilities) and the
// app session cookie are the Worker's. This provider bridges the
// two — it watches Clerk's signed-in state and either resumes the
// existing nsf_session cookie (`api.me()`) or exchanges a Clerk
// JWT for one (`api.exchange()`). Once the cookie is in place the
// rest of the app uses `useAuth()` exactly as before, with the
// same `{ user, loading, logout }` shape that all the existing
// consumers expect.
//
// `login()` is intentionally absent from the interface — sign-in
// is now Clerk's `<SignIn />` widget, not an in-app form. The 14
// pages that call `useAuth()` only read `user` and (in one case)
// `logout`, so dropping `login` is a no-op for them.

type AuthState = {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn } = useUser();
  const { getToken, signOut } = useClerkAuth();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Bridge Clerk's signed-in state to the local cookie session.
  // Three transitions matter:
  //   * Clerk done loading + signed in + no local user yet
  //       → try api.me() first (cookie may already be valid from a
  //         prior session, in which case Clerk is a formality);
  //         fall back to api.exchange(clerkJwt) if no cookie.
  //   * Clerk done loading + signed out
  //       → drop any local user we were holding (Clerk session
  //         ended out-of-band, e.g. via the Clerk dashboard).
  //   * Clerk still loading
  //       → keep `loading` true so App.tsx renders the splash, not
  //         the sign-in screen.
  useEffect(() => {
    if (!clerkLoaded) return;
    let cancelled = false;
    (async () => {
      if (!isSignedIn) {
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      try {
        const me = await api.me();
        if (cancelled) return;
        setUser(me.user);
        // Same trigger as the legacy session-resume path — first
        // manifest after sign-in seeds an empty cache or refreshes
        // a stale one. (L4.1a)
        void pullManifest();
      } catch {
        // No (or stale) cookie. Exchange the Clerk JWT for one.
        try {
          const clerkToken = await getToken();
          if (!clerkToken) throw new Error('clerk getToken returned null');
          const ex = await api.exchange(clerkToken);
          if (cancelled) return;
          setUser(ex.user);
          void pullManifest();
        } catch (err) {
          // Sign-out on the Clerk side too so we don't loop. The
          // user is dropped on the next Clerk state change.
          console.warn('exchange failed, signing out of clerk', err);
          await signOut().catch(() => undefined);
          if (!cancelled) setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clerkLoaded, isSignedIn, getToken, signOut]);

  const logout = useCallback(async () => {
    // Clear the local cookie first so even if the Clerk sign-out
    // round-trip fails (offline) the Worker treats us as signed
    // out on the very next request.
    await api.logout().catch(() => undefined);
    setUser(null);
    // §6.8 — wipe device-local user data on session end.
    try {
      await wipeCache();
    } catch {
      // IDB might be unavailable (private mode, quota); logout
      // still completes.
    }
    // Ends the Clerk session too. Best-effort — if we're offline,
    // Clerk's SDK queues this; the cookie is already gone so the
    // app behaves as signed out regardless.
    await signOut().catch(() => undefined);
  }, [signOut]);

  const value = useMemo(
    () => ({ user, loading, logout }),
    [user, loading, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
