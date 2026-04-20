// Drill-down dashboard types and constants (spec §3.6.1 / §5.11).
// Single source of truth for both apps — the server validates
// against this list; the client renders tiles from it.

export const GEO_LEVELS = [
  'india',
  'zone',
  'state',
  'region',
  'district',
  'cluster',
  'village',
] as const;

export type GeoLevel = (typeof GEO_LEVELS)[number];

// Five metrics per §3.6.1. Adding a sixth requires a matching
// aggregator + leaf branch on the server (exhaustiveness check
// in `buildDrillDown` catches the omission at compile time).
export const DASHBOARD_METRICS = [
  'vc',
  'af',
  'children',
  'attendance',
  'achievements',
] as const;

export type DashboardMetric = (typeof DASHBOARD_METRICS)[number];

export function isGeoLevel(value: unknown): value is GeoLevel {
  return typeof value === 'string' && (GEO_LEVELS as readonly string[]).includes(value);
}

export function isDashboardMetric(value: unknown): value is DashboardMetric {
  return typeof value === 'string' && (DASHBOARD_METRICS as readonly string[]).includes(value);
}
