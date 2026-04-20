export type Role = 'vc' | 'af' | 'cluster_admin' | 'super_admin';
export type ScopeLevel = 'village' | 'cluster' | 'global';

export type Bindings = {
  DB: D1Database;
  // Comma-separated allowlist of origins that may make credentialed
  // requests. Set in wrangler.toml [vars]. Empty / unset means
  // same-origin only (the Vite dev proxy + the deployed Pages site).
  ALLOWED_ORIGINS?: string;
  // 'development' | 'production'. Drives the `Secure` cookie flag.
  ENVIRONMENT?: string;
};

export type SessionUser = {
  id: number;
  user_id: string;
  full_name: string;
  role: Role;
  scope_level: ScopeLevel;
  scope_id: number | null;
};

export type Variables = {
  user: SessionUser;
};
