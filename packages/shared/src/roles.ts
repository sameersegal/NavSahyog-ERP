// Role + scope literals. Single source of truth for both apps;
// mirrors spec §2.1 / §4.3.1.
//
// L2.0 onboards the four read-only geo-admin tiers. Their only
// capabilities are `.read`; B3 from
// requirements/review-findings-v1.md is structurally closed
// because the capability matrix below never grants them a
// `.write` anything.

export type Role =
  | 'vc'
  | 'af'
  | 'cluster_admin'
  | 'district_admin'
  | 'region_admin'
  | 'state_admin'
  | 'zone_admin'
  | 'super_admin';

export type ScopeLevel =
  | 'village'
  | 'cluster'
  | 'district'
  | 'region'
  | 'state'
  | 'zone'
  | 'global';

// Roles and scope_levels listed in iteration order (broadest last).
// Useful for any UI that needs a stable order, e.g. a role picker
// in Master Creations (L3). Keep this aligned with the `Role` and
// `ScopeLevel` unions above.
export const ROLES: readonly Role[] = [
  'vc',
  'af',
  'cluster_admin',
  'district_admin',
  'region_admin',
  'state_admin',
  'zone_admin',
  'super_admin',
];

export const SCOPE_LEVELS: readonly ScopeLevel[] = [
  'village',
  'cluster',
  'district',
  'region',
  'state',
  'zone',
  'global',
];
