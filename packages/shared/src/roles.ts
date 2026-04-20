// Role + scope literals. Single source of truth for both apps;
// mirrors spec §2.1 / §4.3.1.
//
// L1 ships with four roles. L2 onboards read-only District /
// Region / State / Zone tiers — add them here and the compile
// fans the update out across client + server.

export type Role = 'vc' | 'af' | 'cluster_admin' | 'super_admin';

export type ScopeLevel = 'village' | 'cluster' | 'global';
