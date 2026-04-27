// Donor-facing public surface (no auth). Sole purpose for now:
// serve aggregate + per-pond data for the public Jal Vriddhi map at
// `/donor`. Lives under `/api/public/` so a single carve-out covers
// both the staging basic-auth gate and any future read-only routes.
//
// PII discipline:
//   * Farmer phone is never returned.
//   * Farmer last name is dropped — only the first token of full_name
//     leaves the Worker. This matches the donor-app intent (show
//     beneficiary scale, not identifiable individuals).
//   * Agreement metadata (uuid, r2_key, filenames, byte counts) is
//     omitted entirely.
//
// The endpoint is intentionally cheap: one query for the rows, one
// for total/status/state counts. No pagination — the dataset is
// village-scale (tens, eventually low thousands of ponds), well
// within a single response.

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const publicRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type PondRow = {
  id: number;
  latitude: number;
  longitude: number;
  status: 'planned' | 'dug' | 'active' | 'inactive';
  notes: string | null;
  plot_identifier: string | null;
  full_name: string;
  created_at: number;
  village_name: string;
  cluster_name: string;
  district_name: string;
  state_name: string;
  zone_name: string;
};

type StatusCount = { status: string; n: number };
type StateCount = { state_name: string; n: number };

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed) return '';
  const space = trimmed.indexOf(' ');
  return space < 0 ? trimmed : trimmed.slice(0, space);
}

publicRoutes.get('/ponds', async (c) => {
  const rs = await c.env.DB
    .prepare(
      `SELECT
         p.id,
         p.latitude,
         p.longitude,
         p.status,
         p.notes,
         p.created_at,
         f.full_name,
         f.plot_identifier,
         v.name AS village_name,
         cl.name AS cluster_name,
         d.name AS district_name,
         s.name AS state_name,
         z.name AS zone_name
       FROM pond p
       JOIN farmer f   ON f.id = p.farmer_id
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
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status,
    notes: row.notes,
    farmer_first_name: firstName(row.full_name),
    plot_identifier: row.plot_identifier,
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

  // Distinct counts pulled off the loaded rows — saves an extra D1
  // round-trip and the dataset is small.
  const villages = new Set(ponds.map((p) => p.village)).size;
  const districts = new Set(ponds.map((p) => p.district)).size;
  const states = new Set(ponds.map((p) => p.state)).size;

  return c.json({
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

export default publicRoutes;
