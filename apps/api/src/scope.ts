import type { SessionUser } from './types';

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
  if (user.scope_level === 'cluster') {
    if (!user.scope_id) return [];
    const rs = await db
      .prepare('SELECT id FROM village WHERE cluster_id = ?')
      .bind(user.scope_id)
      .all<{ id: number }>();
    return rs.results.map((r) => r.id);
  }
  return [];
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
