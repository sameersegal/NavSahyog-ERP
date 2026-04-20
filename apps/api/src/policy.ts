// Capability matrix (mirrors spec §2.3). Single source of truth for
// "which role can do what action." Scope ("which resources can this
// specific user see") is parameterised by request data and lives in
// scope.ts — don't move it here.
//
// Adding a role: add it to Role in types.ts, then list the caps it
// carries below. Adding a capability: add one line + gate the route
// with `requireCap('…')`.

import type { MiddlewareHandler } from 'hono';
import { err } from './lib/errors';
import type { Bindings, Role, SessionUser, Variables } from './types';

export type Capability =
  | 'village.read'
  | 'school.read'
  | 'child.read'
  | 'child.write'
  | 'attendance.read'
  | 'attendance.write'
  | 'dashboard.read';

// Role → capabilities the role carries. L1 has only four roles, all
// of which currently share the same capabilities. L2+ onboards the
// read-only District / Region / State / Zone tiers — those rows
// will only list `.read` caps, which is the structural fix for
// blocker B3 in requirements/review-findings-v1.md.
const CAPABILITIES_BY_ROLE = {
  vc: [
    'village.read',
    'school.read',
    'child.read',
    'child.write',
    'attendance.read',
    'attendance.write',
    'dashboard.read',
  ],
  af: [
    'village.read',
    'school.read',
    'child.read',
    'child.write',
    'attendance.read',
    'attendance.write',
    'dashboard.read',
  ],
  cluster_admin: [
    'village.read',
    'school.read',
    'child.read',
    'child.write',
    'attendance.read',
    'attendance.write',
    'dashboard.read',
  ],
  super_admin: [
    'village.read',
    'school.read',
    'child.read',
    'child.write',
    'attendance.read',
    'attendance.write',
    'dashboard.read',
  ],
} as const satisfies Record<Role, readonly Capability[]>;

export function capabilitiesFor(role: Role): readonly Capability[] {
  // Fail closed: an unknown role (e.g. one introduced in the DB but
  // not yet declared here) has no capabilities rather than crashing.
  return CAPABILITIES_BY_ROLE[role] ?? [];
}

export function can(user: Pick<SessionUser, 'role'>, cap: Capability): boolean {
  return (capabilitiesFor(user.role) as readonly Capability[]).includes(cap);
}

// Hono middleware factory. Must run after `requireAuth` so `user`
// is set on the context. Typo-proof: Capability is a union of
// literals, so `requireCap('child.writ')` fails to compile.
export function requireCap(
  cap: Capability,
): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const user = c.get('user');
    if (!can(user, cap)) return err(c, 'forbidden', 403);
    await next();
  };
}
