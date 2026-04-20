// Capability matrix. Single source of truth for both apps; mirrors
// spec §2.3. Scope ("which resources can this specific user see")
// is parameterised by request data and lives on the server in
// scope.ts — don't move it here.
//
// Adding a role: add it to Role in roles.ts, then list the caps it
// carries below. Adding a capability: add one line + gate the
// route with `requireCap('…')` on the server.

import type { Role } from './roles';

export type Capability =
  | 'village.read'
  | 'school.read'
  | 'child.read'
  | 'child.write'
  | 'attendance.read'
  | 'attendance.write'
  | 'dashboard.read';

// L1 has only four roles, all of which currently share the same
// capabilities. L2+ onboards read-only District / Region / State /
// Zone tiers — those rows will only list `.read` caps, which is
// the structural fix for blocker B3 in
// requirements/review-findings-v1.md.
export const CAPABILITIES_BY_ROLE = {
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
  // Fail closed: an unknown role (e.g. one introduced in the DB
  // but not yet declared here) has no capabilities rather than
  // crashing.
  return CAPABILITIES_BY_ROLE[role] ?? [];
}

// Pure check against an already-serialised user (wire shape). Used
// on the client to hide UI; the server is authoritative.
export function can(
  user: { capabilities: readonly Capability[] } | null | undefined,
  cap: Capability,
): boolean {
  if (!user) return false;
  return user.capabilities.includes(cap);
}
