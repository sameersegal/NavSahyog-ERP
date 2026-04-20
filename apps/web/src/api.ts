export type Role = 'vc' | 'af' | 'cluster_admin' | 'super_admin';
export type ScopeLevel = 'village' | 'cluster' | 'global';

// Capabilities come from the server on /auth/login and /auth/me —
// don't hardcode a matrix on the client. See apps/api/src/policy.ts.
export type Capability =
  | 'village.read'
  | 'school.read'
  | 'child.read'
  | 'child.write'
  | 'attendance.read'
  | 'attendance.write'
  | 'dashboard.read';

export type User = {
  id: number;
  user_id: string;
  full_name: string;
  role: Role;
  scope_level: ScopeLevel;
  scope_id: number | null;
  capabilities: readonly Capability[];
};

export function can(user: User | null, cap: Capability): boolean {
  if (!user) return false;
  return user.capabilities.includes(cap);
}

export type Village = {
  id: number;
  name: string;
  code: string;
  cluster_id: number;
  cluster_name: string;
};

export type School = { id: number; village_id: number; name: string };

export type Child = {
  id: number;
  village_id: number;
  school_id: number;
  first_name: string;
  last_name: string;
  gender: 'm' | 'f' | 'o';
  dob: string;            // IST 'YYYY-MM-DD'
  joined_at: string;      // IST 'YYYY-MM-DD'
  graduated_at: string | null;
};

export type AttendanceMark = { student_id: number; present: boolean };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  login: (user_id: string, password: string) =>
    req<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ user_id, password }),
    }),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => req<{ user: User }>('/auth/me'),
  villages: () => req<{ villages: Village[] }>('/api/villages'),
  schools: (villageId: number) =>
    req<{ schools: School[] }>(`/api/schools?village_id=${villageId}`),
  children: (villageId: number) =>
    req<{ children: Child[] }>(`/api/children?village_id=${villageId}`),
  addChild: (body: {
    village_id: number;
    school_id: number;
    first_name: string;
    last_name: string;
    gender: 'm' | 'f' | 'o';
    dob: string;          // IST 'YYYY-MM-DD'
  }) =>
    req<{ id: number }>('/api/children', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  attendance: (villageId: number, date?: string) =>
    req<{
      session: { id: number; village_id: number; date: string } | null;
      marks: AttendanceMark[];
    }>(
      `/api/attendance?village_id=${villageId}${date ? `&date=${date}` : ''}`,
    ),
  submitAttendance: (body: {
    village_id: number;
    date?: string;        // IST 'YYYY-MM-DD'
    marks: AttendanceMark[];
  }) =>
    req<{ session_id: number; count: number }>('/api/attendance', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dashboardChildren: () =>
    req<{
      villages: Array<{
        village_id: number;
        village_name: string;
        cluster_id: number;
        cluster_name: string;
        count: number;
      }>;
    }>('/api/dashboard/children'),
  dashboardAttendance: (date?: string) =>
    req<{
      date: string;
      villages: Array<{
        village_id: number;
        village_name: string;
        cluster_id: number;
        cluster_name: string;
        present: number;
        total: number;
        marked: boolean;
      }>;
    }>(`/api/dashboard/attendance${date ? `?date=${date}` : ''}`),
};
