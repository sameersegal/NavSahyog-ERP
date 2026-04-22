// Geo helpers for the drill-down dashboard (§3.6.1, §5.11).
//
// The hierarchy is fixed: india (virtual root) -> zone -> state ->
// region -> district -> cluster -> village. `village` is the leaf;
// at that level the dashboard shows per-detail rows (per student,
// per session, per award) rather than a further aggregate.
//
// `GEO_LEVELS` / `GeoLevel` are re-exported from @navsahyog/shared
// so both apps see the same list. This file adds the server-only
// pieces (join chain, alias mapping, child-level helper).

import { GEO_LEVELS, type BreadcrumbCrumb, type GeoLevel } from '@navsahyog/shared';
export { GEO_LEVELS, isGeoLevel, type GeoLevel } from '@navsahyog/shared';

// Every non-root level has a parent, so the child of anything is
// always a non-india level. The TS narrowing matters: downstream
// callers index LEVEL_ALIAS (which excludes india) with the result.
export type NonRootLevel = Exclude<GeoLevel, 'india'>;

// Returns the child level, or null if `level` is the leaf (village).
export function childLevelOf(level: GeoLevel): NonRootLevel | null {
  const idx = GEO_LEVELS.indexOf(level);
  if (idx >= GEO_LEVELS.length - 1) return null;
  return GEO_LEVELS[idx + 1] as NonRootLevel;
}

// Join chain from `village` up to any ancestor. Used both for scope
// filtering ("which villages live under this zone?") and breadcrumb
// construction ("what's the display name at each ancestor level?").
// Aliased per level so callers can SELECT any column cleanly.
export const GEO_JOIN = `
  FROM village v
  JOIN cluster  c  ON c.id  = v.cluster_id
  JOIN district d  ON d.id  = c.district_id
  JOIN region   r  ON r.id  = d.region_id
  JOIN state    st ON st.id = r.state_id
  JOIN zone     z  ON z.id  = st.zone_id
`;

// Table aliases matching GEO_JOIN. `india` has no alias — it's the
// virtual root; an india-level filter means "no constraint".
export const LEVEL_ALIAS: Record<NonRootLevel, string> = {
  zone: 'z',
  state: 'st',
  region: 'r',
  district: 'd',
  cluster: 'c',
  village: 'v',
};

// Villages under (level, id) — no scope filter yet. For india, no
// filter at all. Callers typically intersect the result with the
// user's scope before using it.
export async function villagesUnder(
  db: D1Database,
  level: GeoLevel,
  id: number | null,
): Promise<number[]> {
  if (level === 'india') {
    const rs = await db.prepare('SELECT id FROM village').all<{ id: number }>();
    return rs.results.map((r) => r.id);
  }
  if (id === null) return [];
  const alias = LEVEL_ALIAS[level];
  const sql = `SELECT v.id AS id ${GEO_JOIN} WHERE ${alias}.id = ?`;
  const rs = await db.prepare(sql).bind(id).all<{ id: number }>();
  return rs.results.map((r) => r.id);
}

// Breadcrumb for (level, id). Always starts with India and walks
// down to the requested level. Returns just `[india]` when (level,
// id) doesn't resolve — callers distinguish that from a valid
// india request by checking the original level.
export async function breadcrumbFor(
  db: D1Database,
  level: GeoLevel,
  id: number | null,
): Promise<BreadcrumbCrumb[]> {
  const crumbs: BreadcrumbCrumb[] = [
    { level: 'india', id: null, name: 'India' },
  ];
  if (level === 'india' || id === null) return crumbs;
  const rs = await db
    .prepare(
      `SELECT z.id AS zone_id, z.name AS zone_name,
              st.id AS state_id, st.name AS state_name,
              r.id  AS region_id,   r.name  AS region_name,
              d.id  AS district_id, d.name  AS district_name,
              c.id  AS cluster_id,  c.name  AS cluster_name,
              v.id  AS village_id,  v.name  AS village_name
       ${GEO_JOIN}
       WHERE ${LEVEL_ALIAS[level]}.id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<{
      zone_id: number; zone_name: string;
      state_id: number; state_name: string;
      region_id: number; region_name: string;
      district_id: number; district_name: string;
      cluster_id: number; cluster_name: string;
      village_id: number; village_name: string;
    }>();
  if (!rs) return crumbs;
  const ordered: Array<[GeoLevel, number, string]> = [
    ['zone', rs.zone_id, rs.zone_name],
    ['state', rs.state_id, rs.state_name],
    ['region', rs.region_id, rs.region_name],
    ['district', rs.district_id, rs.district_name],
    ['cluster', rs.cluster_id, rs.cluster_name],
    ['village', rs.village_id, rs.village_name],
  ];
  const stopAt = GEO_LEVELS.indexOf(level);
  for (let i = 0; i < stopAt; i++) {
    const [lvl, cid, cname] = ordered[i]!;
    crumbs.push({ level: lvl, id: cid, name: cname });
  }
  return crumbs;
}

// Intersection of scope and requested area. Returns 'out_of_scope'
// when the area exists but the user can see none of it — callers
// emit 403 rather than silently 200-empty.
export async function effectiveVillages(
  db: D1Database,
  scopeVillageIds: number[],
  level: GeoLevel,
  id: number | null,
): Promise<number[] | 'out_of_scope'> {
  const area = await villagesUnder(db, level, id);
  if (level === 'india') {
    return scopeVillageIds.filter((v) => area.includes(v));
  }
  if (area.length === 0) return [];
  const scopeSet = new Set(scopeVillageIds);
  const intersection = area.filter((v) => scopeSet.has(v));
  if (intersection.length === 0) return 'out_of_scope';
  return intersection;
}
