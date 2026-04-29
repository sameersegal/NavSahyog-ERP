// /api/sync/* — manifest endpoint for the offline read cache
// (L4.1a; D32 replace-snapshot, supersedes the §6.9 delta protocol).
//
// L4.1a ships GET /api/sync/manifest only. Returns the user's full
// scope as a snapshot — villages they can see + active students in
// those villages. The client wipes its `cache_villages` and
// `cache_students` IDB stores and reseeds from this response, so
// the rule is "what's in the response is what's in the cache".
//
// Per offline-scope.md "Scope-bound caching", a VC's manifest is
// kilobytes (one village + dozens of students). District+ roles
// use the same endpoint but the dashboards they hit are
// `online-only`, so their cache stays minimal.
//
// Out of scope for L4.1a (deferred to L4.1c+): events, schools.
// Adding them is a row in the response shape; the additive-only
// rule (D30) keeps existing clients happy.

import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { villageIdsInScope } from '../scope';
import { nowEpochSeconds } from '../lib/time';
import type { Bindings, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

type ManifestVillage = {
  id: number;
  name: string;
  code: string;
  cluster_id: number;
  cluster_name: string;
};

type ManifestStudent = {
  id: number;
  village_id: number;
  school_id: number;
  first_name: string;
  last_name: string;
};

// L4.1c — events are global (not scope-bound per village). Same
// shape as the live `/api/events` GET; included in the manifest so
// the AttendanceForm picker has a cache to read from offline.
type ManifestEvent = {
  id: number;
  name: string;
  kind: string;
  description: string | null;
};

type ManifestResponse = {
  // Server epoch seconds. Stored on the client for "last synced at"
  // diagnostics; not used for delta calc (D32 — full snapshot).
  generated_at: number;
  // The scope the manifest covers — derived from the authenticated
  // session, not user input. Useful for sanity checks (a client that
  // somehow seeded a wrong-scope cache can detect the divergence by
  // comparing against this).
  scope: {
    level: string;
    id: number | null;
    village_ids: number[];
  };
  villages: ManifestVillage[];
  students: ManifestStudent[];
  events: ManifestEvent[];
};

// Walked by scripts/gen-matrix.mjs. Sync drives the cached read
// stores on other resources (villages, children, events) — those
// resources mark their reads as `cached`; this endpoint is the
// pull mechanism and is itself online-only.
export const meta: RouteMeta = {
  context: 'sync',
  resource: 'sync',
  cra: 'read-only',
  offline: { read: 'online-only' },
  refs: ['§6.9', 'D32'],
};

const sync = new Hono<{ Bindings: Bindings; Variables: Variables }>();

sync.use('*', requireAuth);

sync.get('/manifest', async (c) => {
  const user = c.get('user');
  const villageIds = await villageIdsInScope(c.env.DB, user);

  // Events are global, not scope-bound — every authenticated caller
  // sees the same list. Pull once outside the village-scope branch
  // so an empty-scope user (cluster-admin awaiting assignment)
  // still gets the picklist in their cache.
  const eventsRs = await c.env.DB.prepare(
    `SELECT id, name, kind, description
       FROM event
      ORDER BY name`,
  ).all<ManifestEvent>();

  // Empty scope is valid (e.g. a newly-created cluster admin with no
  // villages assigned yet). Return the empty arrays — the client
  // wipes its cache and renders "no villages in scope" for picker
  // reads, which is the spec'd state.
  if (villageIds.length === 0) {
    const body: ManifestResponse = {
      generated_at: nowEpochSeconds(),
      scope: {
        level: user.scope_level,
        id: user.scope_id,
        village_ids: [],
      },
      villages: [],
      students: [],
      events: eventsRs.results,
    };
    return c.json(body);
  }

  const placeholders = villageIds.map(() => '?').join(',');

  const villagesRs = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.code, v.cluster_id, c.name AS cluster_name
       FROM village v
       JOIN cluster c ON c.id = v.cluster_id
      WHERE v.id IN (${placeholders})
      ORDER BY v.name`,
  )
    .bind(...villageIds)
    .all<ManifestVillage>();

  // Active students only — graduated rows are excluded from
  // achievement workflows server-side anyway, and the cache is
  // bounded by §6.10 capacity targets.
  const studentsRs = await c.env.DB.prepare(
    `SELECT id, village_id, school_id, first_name, last_name
       FROM student
      WHERE village_id IN (${placeholders})
        AND graduated_at IS NULL
      ORDER BY village_id, last_name, first_name`,
  )
    .bind(...villageIds)
    .all<ManifestStudent>();

  const body: ManifestResponse = {
    generated_at: nowEpochSeconds(),
    scope: {
      level: user.scope_level,
      id: user.scope_id,
      village_ids: villageIds,
    },
    villages: villagesRs.results,
    students: studentsRs.results,
    events: eventsRs.results,
  };
  return c.json(body);
});

export default sync;
