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
  | 'village.write'
  | 'school.read'
  | 'school.write'
  | 'child.read'
  | 'child.write'
  | 'event.read'
  | 'event.write'
  | 'attendance.read'
  | 'attendance.write'
  | 'achievement.read'
  | 'achievement.write'
  | 'media.read'
  | 'media.write'
  | 'pond.read'
  | 'pond.write'
  | 'qualification.write'
  | 'training_manual.read'
  | 'training_manual.write'
  | 'user.write'
  | 'dashboard.read';

// Read-only caps shared by every viewer tier. Write tiers extend
// with the write caps.
const READ_ONLY: readonly Capability[] = [
  'village.read',
  'school.read',
  'child.read',
  'event.read',
  'attendance.read',
  'achievement.read',
  'media.read',
  'pond.read',
  'training_manual.read',
  'dashboard.read',
];

const WRITE: readonly Capability[] = [
  ...READ_ONLY,
  'child.write',
  'attendance.write',
  'achievement.write',
  'media.write',
  'pond.write',
];

// L3.1 Master-Creations writes (decisions.md D22). Granted only to
// super_admin per §2.3. `qualification.write` and `user.write` also
// gate the corresponding LIST endpoints — those masters have no
// non-admin consumer yet, so the read cap doesn't need a separate
// row in the matrix.
const SUPER_ADMIN_ONLY: readonly Capability[] = [
  'village.write',
  'school.write',
  'event.write',
  'qualification.write',
  'training_manual.write',
  'user.write',
];

// Mirrors §2.3. District / Region / State / Zone admins only carry
// `.read` caps — that's the structural closure for blocker B3 in
// requirements/review-findings-v1.md. The server's `requireCap`
// middleware (apps/api/src/policy.ts) gates every write route on
// one of the `.write` capabilities, so adding a geo-admin role
// needs no route changes to stay read-only.
export const CAPABILITIES_BY_ROLE = {
  // `pending` is the post-webhook, pre-promotion state for a row
  // that /webhooks/clerk inserted on user.created. Sign-in works
  // but no capability is granted until an admin assigns a real
  // role via /api/users PATCH.
  pending: [],
  vc: WRITE,
  af: WRITE,
  cluster_admin: WRITE,
  district_admin: READ_ONLY,
  region_admin: READ_ONLY,
  state_admin: READ_ONLY,
  zone_admin: READ_ONLY,
  super_admin: [...WRITE, ...SUPER_ADMIN_ONLY],
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
