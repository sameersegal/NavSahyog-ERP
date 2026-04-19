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

export async function assertVillageInScope(
  db: D1Database,
  user: SessionUser,
  villageId: number,
): Promise<boolean> {
  const ids = await villageIdsInScope(db, user);
  return ids.includes(villageId);
}
