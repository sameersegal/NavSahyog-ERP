// Shapes that are part of the API contract (Role, Capability, User,
// Student) come from @navsahyog/shared — same source the server reads.
// Shapes specific to a response body (Village, School, etc.) live
// here until we have a reason to share them.

export type {
  AuthUser as User,
  Capability,
  Role,
  ScopeLevel,
  Student as Child,
  Gender,
  GraduationReason,
  Event,
  EventKind,
  AttendanceMark,
  AttendanceSession,
  AttendanceSessionWithMarks,
} from '@navsahyog/shared';
export { can, isIndianPhone, isIsoDate, isClockTime } from '@navsahyog/shared';

import type {
  AttendanceMark,
  AttendanceSessionWithMarks,
  AuthUser,
  Event,
  GraduationReason,
  Student,
} from '@navsahyog/shared';

export type Village = {
  id: number;
  name: string;
  code: string;
  cluster_id: number;
  cluster_name: string;
};

export type School = { id: number; village_id: number; name: string };

// Wire shape accepted by POST / PATCH /api/children for the
// parent + alt-contact block. Null omits; server treats all fields
// as nullable. Booleans are coerced to 0/1 server-side.
export type ChildProfile = {
  father_name?: string | null;
  father_phone?: string | null;
  father_has_smartphone?: boolean | null;
  mother_name?: string | null;
  mother_phone?: string | null;
  mother_has_smartphone?: boolean | null;
  alt_contact_name?: string | null;
  alt_contact_phone?: string | null;
  alt_contact_relationship?: string | null;
};

export type ChildCoreCreate = {
  village_id: number;
  school_id: number;
  first_name: string;
  last_name: string;
  gender: 'm' | 'f' | 'o';
  dob: string;             // IST 'YYYY-MM-DD'
  joined_at?: string;      // IST 'YYYY-MM-DD'; server defaults to today
};

export type ChildCorePatch = {
  school_id?: number;
  first_name?: string;
  last_name?: string;
  gender?: 'm' | 'f' | 'o';
  dob?: string;
  joined_at?: string;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new Error(
      body.error?.message ?? body.error?.code ?? `HTTP ${res.status}`,
    );
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
  children: (villageId: number, opts?: { includeGraduated?: boolean }) =>
    req<{ children: Student[] }>(
      `/api/children?village_id=${villageId}${opts?.includeGraduated ? '&include_graduated=1' : ''}`,
    ),
  child: (id: number) =>
    req<{ child: Student }>(`/api/children/${id}`),
  addChild: (body: ChildCoreCreate & ChildProfile) =>
    req<{ id: number }>('/api/children', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateChild: (id: number, body: ChildCorePatch & ChildProfile) =>
    req<{ child: Student }>(`/api/children/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  graduateChild: (
    id: number,
    body: { graduated_at?: string; graduation_reason?: GraduationReason } = {},
  ) =>
    req<{ child: Student }>(`/api/children/${id}/graduate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  events: () => req<{ events: Event[] }>('/api/events'),
  attendance: (villageId: number, date?: string) =>
    req<{
      date: string;
      sessions: AttendanceSessionWithMarks[];
    }>(
      `/api/attendance?village_id=${villageId}${date ? `&date=${date}` : ''}`,
    ),
  submitAttendance: (body: {
    village_id: number;
    event_id: number;
    date?: string;          // IST 'YYYY-MM-DD'
    start_time: string;     // IST 'HH:MM'
    end_time: string;       // IST 'HH:MM'
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
        sessions: number;
        marked: boolean;
      }>;
    }>(`/api/dashboard/attendance${date ? `?date=${date}` : ''}`),
};
