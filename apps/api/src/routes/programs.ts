// Public, embeddable program APIs (no auth, no cookies, CORS open).
// Each program gets one read-only endpoint that returns aggregate
// stats + per-row markers safe for embedding on third-party sites
// (the NavSahyog public website, donor microsites, partner pages).
//
// PII discipline — strict allowlist on the wire:
//   * No farmer names, no plot identifiers, no phone numbers.
//   * No free-text notes (VC-authored; could mention named
//     beneficiaries or sensitive details).
//   * Coordinates rounded to 3 decimals (~110 m) so an exact plot
//     can't be pinpointed; village-scale clustering still works.
//   * No agreement metadata (uuid, r2_key, filenames, byte counts).
//   * No internal user / created_by ids.
//
// Currently one program: §3.10 Jal Vriddhi (ponds + agreements).
// Add new programs as siblings under this router (e.g.
// `programs.get('/dhan-kaushal', ...)` or move to a sub-folder when
// the count grows past ~3).

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

// Walked by scripts/gen-matrix.mjs. Public, embeddable program
// APIs — no auth, no cookies, CORS open. Capability column shows
// `public` in the generated matrix.
export const meta: RouteMeta = {
  context: 'programs',
  resource: 'programs',
  cra: 'read-only',
  offline: { read: 'online-only' },
  refs: ['§3.10'],
};

const programs = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type PondRow = {
  id: number;
  latitude: number;
  longitude: number;
  status: 'planned' | 'dug' | 'active' | 'inactive';
  created_at: number;
  village_name: string;
  cluster_name: string;
  district_name: string;
  state_name: string;
  zone_name: string;
};
type StatusCount = { status: string; n: number };
type StateCount = { state_name: string; n: number };

// ~110 m precision — enough to land in the right village on a map
// without identifying a specific plot.
function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

programs.get('/jal-vriddhi', async (c) => {
  const rs = await c.env.DB
    .prepare(
      `SELECT
         p.id,
         p.latitude,
         p.longitude,
         p.status,
         p.created_at,
         v.name  AS village_name,
         cl.name AS cluster_name,
         d.name  AS district_name,
         s.name  AS state_name,
         z.name  AS zone_name
       FROM pond p
       JOIN village v  ON v.id = p.village_id
       JOIN cluster cl ON cl.id = v.cluster_id
       JOIN district d ON d.id = cl.district_id
       JOIN region r   ON r.id = d.region_id
       JOIN state s    ON s.id = r.state_id
       JOIN zone z     ON z.id = s.zone_id
       WHERE p.deleted_at IS NULL
       ORDER BY p.created_at DESC`,
    )
    .all<PondRow>();

  const ponds = rs.results.map((row) => ({
    id: row.id,
    latitude: roundCoord(row.latitude),
    longitude: roundCoord(row.longitude),
    status: row.status,
    village: row.village_name,
    cluster: row.cluster_name,
    district: row.district_name,
    state: row.state_name,
    zone: row.zone_name,
    created_at: row.created_at,
  }));

  const byStatusRs = await c.env.DB
    .prepare(
      `SELECT status, COUNT(*) AS n
         FROM pond
        WHERE deleted_at IS NULL
        GROUP BY status`,
    )
    .all<StatusCount>();
  const byStatus: Record<string, number> = {
    planned: 0, dug: 0, active: 0, inactive: 0,
  };
  for (const row of byStatusRs.results) byStatus[row.status] = row.n;

  const byStateRs = await c.env.DB
    .prepare(
      `SELECT s.name AS state_name, COUNT(*) AS n
         FROM pond p
         JOIN village v  ON v.id = p.village_id
         JOIN cluster cl ON cl.id = v.cluster_id
         JOIN district d ON d.id = cl.district_id
         JOIN region r   ON r.id = d.region_id
         JOIN state s    ON s.id = r.state_id
        WHERE p.deleted_at IS NULL
        GROUP BY s.name
        ORDER BY n DESC`,
    )
    .all<StateCount>();
  const byState = byStateRs.results.map((r) => ({ state: r.state_name, count: r.n }));

  const villages = new Set(ponds.map((p) => p.village)).size;
  const districts = new Set(ponds.map((p) => p.district)).size;
  const states = new Set(ponds.map((p) => p.state)).size;

  return c.json({
    program: 'jal-vriddhi',
    stats: {
      total: ponds.length,
      by_status: byStatus,
      by_state: byState,
      villages,
      districts,
      states,
    },
    ponds,
  });
});

export default programs;
