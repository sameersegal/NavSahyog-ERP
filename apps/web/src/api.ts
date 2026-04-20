// Shapes that are part of the API contract (Role, Capability,
// User) come from @navsahyog/shared — same source the server reads.
// Shapes specific to a response body (Village, Child, etc.) live
// here until we have a reason to share them.

export type { AuthUser as User, Capability, Role, ScopeLevel } from '@navsahyog/shared';
export { can } from '@navsahyog/shared';

import type { AuthUser } from '@navsahyog/shared';

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
    req<{ user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ user_id, password }),
    }),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => req<{ user: AuthUser }>('/auth/me'),
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
