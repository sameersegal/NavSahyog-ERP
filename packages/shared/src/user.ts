import type { Capability } from './capabilities';
import type { Role, ScopeLevel } from './roles';

// Minimal identity the server carries in a session — no caps yet.
// Server-internal; the DB row shape before serialisation.
export type BaseUser = {
  id: number;
  user_id: string;
  full_name: string;
  role: Role;
  scope_level: ScopeLevel;
  scope_id: number | null;
};

// Wire shape returned by /auth/login and /auth/me. Adds the
// computed capability list so the client never maintains its own
// role matrix.
export type AuthUser = BaseUser & {
  capabilities: readonly Capability[];
};
