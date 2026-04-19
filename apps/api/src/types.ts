export type Role = 'vc' | 'af' | 'cluster_admin' | 'super_admin';
export type ScopeLevel = 'village' | 'cluster' | 'global';

export type Bindings = {
  DB: D1Database;
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
