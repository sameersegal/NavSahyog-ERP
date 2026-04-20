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

import { GEO_LEVELS, type GeoLevel } from '@navsahyog/shared';
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
