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
  Achievement,
  AchievementWithStudent,
  AchievementType,
  Media,
  MediaKind,
  MediaWithUrls,
  DashboardMetric,
  GeoLevel,
  Farmer,
  Pond,
  PondStatus,
  PondAgreementVersion,
  PondListItem,
  PondDetail,
  AgreementPresignRequest,
  AgreementPresignResponse,
  AgreementCommitRef,
  CreatePondRequest,
  AppendAgreementRequest,
} from '@navsahyog/shared';
export type {
  BreadcrumbCrumb,
  HierarchyChild,
  InsightKpi,
  InsightsResponse,
  StreakResponse,
  VillageActivity,
} from '@navsahyog/shared';
export {
  can,
  isIndianPhone,
  isIsoDate,
  isClockTime,
  AT_RISK_THRESHOLD_DAYS,
  KPI_SPARK_POINTS,
  DASHBOARD_METRICS,
  GEO_LEVELS,
  isDashboardMetric,
  isGeoLevel,
  POND_STATUSES,
  isPondStatus,
  AGREEMENT_MIMES,
  AGREEMENT_MAX_BYTES,
} from '@navsahyog/shared';

import type {
  AchievementType,
  AchievementWithStudent,
  AgreementPresignRequest,
  AgreementPresignResponse,
  AppendAgreementRequest,
  AttendanceMark,
  AttendanceSessionWithMarks,
  AuthUser,
  CreatePondRequest,
  DashboardMetric,
  Event,
  GeoLevel,
  GraduationReason,
  InsightsResponse,
  MediaKind,
  MediaWithUrls,
  PondDetail,
  PondListItem,
  StreakResponse,
  Student,
} from '@navsahyog/shared';

export type Village = {
  id: number;
  name: string;
  code: string;
  cluster_id: number;
  cluster_name: string;
  coordinator_name: string | null;
};

export type School = { id: number; village_id: number; name: string };

// L3.1 Master Creations wire shapes (decisions.md D21–D24).
export type AdminVillage = {
  id: number;
  name: string;
  code: string;
  cluster_id: number;
};

export type AdminSchool = {
  id: number;
  name: string;
  village_id: number;
  village_name: string;
};

export type AdminEvent = {
  id: number;
  name: string;
  kind: 'event' | 'activity';
  description: string | null;
  reference_count: number;
  // 1 once any media/attendance row references the event — server
  // freezes `kind` at that point (review-findings H5).
  kind_locked: 0 | 1;
};

export type Qualification = {
  id: number;
  name: string;
  description: string | null;
};

export type AdminUser = {
  id: number;
  user_id: string;
  full_name: string;
  role: import('@navsahyog/shared').Role;
  scope_level: import('@navsahyog/shared').ScopeLevel;
  scope_id: number | null;
  scope_name: string | null;
};

export type GeoLevels = {
  zone: Array<{ id: number; name: string }>;
  state: Array<{ id: number; name: string }>;
  region: Array<{ id: number; name: string }>;
  district: Array<{ id: number; name: string }>;
  cluster: Array<{ id: number; name: string }>;
  village: Array<{ id: number; name: string }>;
};

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
  photo_media_id?: number | null;
};

export type ChildCorePatch = {
  school_id?: number;
  first_name?: string;
  last_name?: string;
  gender?: 'm' | 'f' | 'o';
  dob?: string;
  joined_at?: string;
  photo_media_id?: number | null;
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
    voice_note_media_id?: number | null;
  }) =>
    req<{ session_id: number; count: number }>('/api/attendance', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  achievements: (opts: {
    village_id?: number;
    from?: string;
    to?: string;
    type?: AchievementType;
  } = {}) => {
    const qs = new URLSearchParams();
    if (opts.village_id) qs.set('village_id', String(opts.village_id));
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    if (opts.type) qs.set('type', opts.type);
    const suffix = qs.toString();
    return req<{ achievements: AchievementWithStudent[] }>(
      `/api/achievements${suffix ? `?${suffix}` : ''}`,
    );
  },
  addAchievement: (body: {
    student_id: number;
    description: string;
    date: string;
    type: AchievementType;
    gold_count?: number;
    silver_count?: number;
  }) =>
    req<{ achievement: AchievementWithStudent }>('/api/achievements', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAchievement: (
    id: number,
    body: {
      description?: string;
      date?: string;
      gold_count?: number | null;
      silver_count?: number | null;
    },
  ) =>
    req<{ achievement: AchievementWithStudent }>(`/api/achievements/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAchievement: (id: number) =>
    req<{ ok: true }>(`/api/achievements/${id}`, { method: 'DELETE' }),
  media: (opts: {
    village_id?: number;
    kind?: MediaKind;
    from?: number;
    to?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (opts.village_id) qs.set('village_id', String(opts.village_id));
    if (opts.kind) qs.set('kind', opts.kind);
    if (opts.from) qs.set('from', String(opts.from));
    if (opts.to) qs.set('to', String(opts.to));
    const suffix = qs.toString();
    return req<{ media: MediaWithUrls[] }>(
      `/api/media${suffix ? `?${suffix}` : ''}`,
    );
  },
  getMedia: (id: number) =>
    req<{ media: MediaWithUrls }>(`/api/media/${id}`),
  dashboardDrilldown: (opts: DrilldownQuery) =>
    req<DrilldownResponse>(
      `/api/dashboard/drilldown?${drilldownQs(opts)}`,
    ),
  // §3.6.4 Field-Dashboard Home. One round-trip carries every block:
  // health score (current + previous + delta), mission (doer only),
  // focus areas, and the eventual compare grid (observer only,
  // currently null pending the mock-first design call).
  dashboardHome: (opts: { window?: HomeWindow; scope?: { level: GeoLevel; id: number | null } } = {}) => {
    const qs = new URLSearchParams();
    if (opts.window) qs.set('window', opts.window);
    if (opts.scope) {
      const scopeStr = opts.scope.id === null
        ? opts.scope.level
        : `${opts.scope.level}:${opts.scope.id}`;
      qs.set('scope', scopeStr);
    }
    const suffix = qs.toString();
    return req<HomeResponse>(`/api/dashboard/home${suffix ? `?${suffix}` : ''}`);
  },
  // CSV URL builder (browsers download via <a href=…> so we never
  // need the response body on the client).
  dashboardDrilldownCsvUrl: (opts: DrilldownQuery) =>
    `/api/dashboard/drilldown.csv?${drilldownQs(opts)}`,
  insights: (opts: { level?: GeoLevel; id?: number | null } = {}) => {
    const qs = new URLSearchParams();
    if (opts.level) qs.set('level', opts.level);
    if (opts.id !== undefined && opts.id !== null) qs.set('id', String(opts.id));
    const suffix = qs.toString();
    return req<InsightsResponse>(
      `/api/insights${suffix ? `?${suffix}` : ''}`,
    );
  },
  streaks: () => req<StreakResponse>('/api/streaks/me'),
  // L2.5.2 — dashboard scope navigation. Both endpoints are already
  // scope-filtered server-side via villageIdsInScope(), so the
  // client just renders whatever comes back.
  geoSearch: (q: string, limit = 20) => {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    return req<{ results: GeoSearchHit[] }>(`/api/geo/search?${qs.toString()}`);
  },
  geoSiblings: (level: GeoLevel, id: number) => {
    const qs = new URLSearchParams({ level, id: String(id) });
    return req<{ siblings: Array<{ id: number; name: string }> }>(
      `/api/geo/siblings?${qs.toString()}`,
    );
  },
  // L3.1 Master Creations — admin endpoints. Each list returns the
  // full table (no scope filter) and each write is gated server-side
  // on the corresponding `*.write` capability.
  adminVillages: () =>
    req<{ villages: AdminVillage[] }>('/api/villages/admin'),
  createVillage: (body: { name: string; code: string; cluster_id: number }) =>
    req<{ village: AdminVillage }>('/api/villages', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateVillage: (
    id: number,
    body: { name?: string; code?: string; cluster_id?: number },
  ) =>
    req<{ village: AdminVillage }>(`/api/villages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  adminSchools: () => req<{ schools: AdminSchool[] }>('/api/schools/admin'),
  createSchool: (body: { name: string; village_id: number }) =>
    req<{ school: AdminSchool }>('/api/schools', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSchool: (id: number, body: { name?: string; village_id?: number }) =>
    req<{ school: AdminSchool }>(`/api/schools/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  adminEvents: () => req<{ events: AdminEvent[] }>('/api/events/admin'),
  createEvent: (body: {
    name: string;
    kind: 'event' | 'activity';
    description?: string | null;
  }) =>
    req<{ event: AdminEvent }>('/api/events', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateEvent: (
    id: number,
    body: {
      name?: string;
      kind?: 'event' | 'activity';
      description?: string | null;
    },
  ) =>
    req<{ event: AdminEvent }>(`/api/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  qualifications: () =>
    req<{ qualifications: Qualification[] }>('/api/qualifications'),
  createQualification: (body: { name: string; description?: string | null }) =>
    req<{ qualification: Qualification }>('/api/qualifications', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateQualification: (
    id: number,
    body: { name?: string; description?: string | null },
  ) =>
    req<{ qualification: Qualification }>(`/api/qualifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  adminUsers: () => req<{ users: AdminUser[] }>('/api/users'),
  createUser: (body: {
    user_id: string;
    full_name: string;
    role: import('@navsahyog/shared').Role;
    scope_id?: number | null;
  }) =>
    req<{ user: AdminUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateUser: (
    id: number,
    body: {
      user_id?: string;
      full_name?: string;
      role?: import('@navsahyog/shared').Role;
      scope_id?: number | null;
    },
  ) =>
    req<{ user: AdminUser }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  geoAll: () => req<{ levels: GeoLevels }>('/api/geo/all'),
  // Jal Vriddhi pond agreements (§3.10).
  ponds: (opts: { village_id?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.village_id) qs.set('village_id', String(opts.village_id));
    const suffix = qs.toString();
    return req<{ ponds: PondListItem[] }>(
      `/api/ponds${suffix ? `?${suffix}` : ''}`,
    );
  },
  pond: (id: number) => req<{ pond: PondDetail }>(`/api/ponds/${id}`),
  presignAgreement: (body: AgreementPresignRequest) =>
    req<AgreementPresignResponse>('/api/ponds/agreements/presign', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createPond: (body: CreatePondRequest) =>
    req<{ pond: PondDetail }>('/api/ponds', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  appendAgreement: (pondId: number, body: AppendAgreementRequest) =>
    req<{ pond: PondDetail }>(`/api/ponds/${pondId}/agreements`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export type GeoSearchHit = {
  level: GeoLevel;
  id: number;
  name: string;
  path: string;
};

export type DrilldownQuery = {
  metric: DashboardMetric;
  level: GeoLevel;
  id?: number | null;
  from?: string;
  to?: string;
  // L2.5.3 — opt-in consolidated KPI pack + 6-month chart alongside
  // the metric-specific rows. Off by default so CSV exports and
  // other callers that only need the table stay cheap.
  consolidated?: boolean;
};
export type ConsolidatedPayload = {
  kpis: {
    attendance_pct: number | null;
    avg_children: number | null;
    image_pct: number | null;
    video_pct: number | null;
    som_current: number;
    som_delta: number | null;
  };
  chart: {
    bars: Array<{ month: string; pct: number | null }>;
  };
};
// §3.6.4 Home — preset-only time switch (decisions.md D20). Custom
// date ranges stay on /dashboard.
export const HOME_WINDOWS = ['7d', '30d', 'mtd'] as const;
export type HomeWindow = (typeof HOME_WINDOWS)[number];

export type HomeMissionKind = 'attendance' | 'image' | 'video' | 'som';

export type HomeResponse = {
  scope: { level: GeoLevel; id: number | null };
  window: HomeWindow;
  period: { from: string; to: string };
  health_score: {
    current: number | null;
    previous: number | null;
    delta: number | null;
  };
  // Present iff the caller has any `.write` capability. Tap routes
  // to the natural write path: image/video → /capture, attendance →
  // village page (VC) or /capture (AF+), som → /achievements.
  mission: {
    kind: HomeMissionKind;
    current: number;
    target: number;
  } | null;
  // Same payload for both branches. Doer client renders the
  // dominant-gap label per row ("needs photos"); observer client
  // renders the full 4-KPI strip + Health Score. D19 (revised) —
  // the full sibling-compare grid lives on /dashboard, not on Home.
  // `level` is always non-root (children of a scope, never india).
  focus_areas: Array<{
    level: Exclude<GeoLevel, 'india'>;
    id: number;
    name: string;
    health_score: number;
    attendance_pct: number | null;
    image_pct: number | null;
    video_pct: number | null;
    som_pct: number | null;
    dominant_gap_kind: HomeMissionKind | null;
  }>;
};

export type DrilldownResponse = {
  metric: DashboardMetric;
  level: GeoLevel;
  id: number | null;
  crumbs: Array<{ level: GeoLevel; id: number | null; name: string }>;
  child_level: GeoLevel | 'detail' | null;
  headers: string[];
  rows: Array<Array<string | number | null>>;
  drill_ids: Array<number | null>;
  period: { from: string; to: string } | null;
  consolidated?: ConsolidatedPayload | null;
};

function drilldownQs(opts: DrilldownQuery): string {
  const qs = new URLSearchParams();
  qs.set('metric', opts.metric);
  qs.set('level', opts.level);
  if (opts.id !== undefined && opts.id !== null) qs.set('id', String(opts.id));
  if (opts.from) qs.set('from', opts.from);
  if (opts.to) qs.set('to', opts.to);
  if (opts.consolidated) qs.set('consolidated', '1');
  return qs.toString();
}
