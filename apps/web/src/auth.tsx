import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, type User } from './api';
import { wipeCache } from './lib/cache';
import { pullManifest } from './lib/manifest';

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (userId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setUser(r.user);
        // Authenticated session resumed — pull the manifest so the
        // read cache is fresh. Fire-and-forget; offline returns
        // null and the prior cache stays in place. (L4.1a)
        void pullManifest();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (userId: string, password: string) => {
    const r = await api.login(userId, password);
    setUser(r.user);
    // Same trigger as session-resume — first manifest after login
    // seeds an empty cache (or refreshes a stale one from a prior
    // logged-out session). (L4.1a)
    void pullManifest();
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    // §6.8 — wipe device-local user data on session end. Outbox is
    // wiped too via the broader IDB clear path; here we touch only
    // the read-cache stores, since the outbox has its own lifecycle.
    try {
      await wipeCache();
    } catch {
      // IDB might be unavailable (private mode, quota); logout
      // still completes.
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
