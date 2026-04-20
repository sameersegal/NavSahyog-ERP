import type { ScopeLevel } from '@navsahyog/shared';
import type { SessionUser } from './types';

// Maps each geo scope level (that isn't village-direct or global) to
// the SQL that finds the village ids rooted at `scope_id`. All joins
// climb the geo tree defined in migrations/0001_init.sql:
//   zone → state → region → district → cluster → village.
const VILLAGE_IDS_SQL: Partial<Record<ScopeLevel, string>> = {
  cluster: 'SELECT id FROM village WHERE cluster_id = ?',
  district: `
    SELECT v.id FROM village v
    JOIN cluster c ON c.id = v.cluster_id
    WHERE c.district_id = ?
  `,
  region: `
    SELECT v.id FROM village v
    JOIN cluster c ON c.id = v.cluster_id
    JOIN district d ON d.id = c.district_id
    WHERE d.region_id = ?
  `,
  state: `
    SELECT v.id FROM village v
    JOIN cluster c ON c.id = v.cluster_id
    JOIN district d ON d.id = c.district_id
    JOIN region r ON r.id = d.region_id
    WHERE r.state_id = ?
  `,
  zone: `
    SELECT v.id FROM village v
    JOIN cluster c ON c.id = v.cluster_id
    JOIN district d ON d.id = c.district_id
    JOIN region r ON r.id = d.region_id
    JOIN state s ON s.id = r.state_id
    WHERE s.zone_id = ?
  `,
};

export async function villageIdsInScope(
  db: D1Database,
  user: SessionUser,
): Promise<number[]> {
  if (user.scope_level === 'global') {
    const rs = await db.prepare('SELECT id FROM village').all<{ id: number }>();
    return rs.results.map((r) => r.id);
  }
  if (user.scope_level === 'village') {
    return user.scope_id ? [user.scope_id] : [];
  }
  const sql = VILLAGE_IDS_SQL[user.scope_level];
  if (!sql || !user.scope_id) return [];
  const rs = await db.prepare(sql).bind(user.scope_id).all<{ id: number }>();
  return rs.results.map((r) => r.id);
}

// Scope check + audit log. Logs a structured warning whenever a
// user attempts a village outside their scope. L1 acceptance #6
// requires this; the formal audit log lands in L5 (§9.4).
export async function assertVillageInScope(
  db: D1Database,
  user: SessionUser,
  villageId: number,
): Promise<boolean> {
  const ids = await villageIdsInScope(db, user);
  const ok = ids.includes(villageId);
  if (!ok) {
    console.warn(
      JSON.stringify({
        event: 'scope_violation',
        user_id: user.user_id,
        role: user.role,
        scope_level: user.scope_level,
        scope_id: user.scope_id,
        attempted_village_id: villageId,
      }),
    );
  }
  return ok;
}
