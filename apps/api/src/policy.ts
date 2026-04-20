// Capability-gate middleware. The capability matrix itself lives
// in `@navsahyog/shared` — both apps import from the same place
// so there's nothing to drift. This file just wires the shared
// `capabilitiesFor()` into a Hono middleware.

import type { MiddlewareHandler } from 'hono';
import { type Capability, capabilitiesFor } from '@navsahyog/shared';
import { err } from './lib/errors';
import type { Bindings, SessionUser, Variables } from './types';

export type { Capability };
export { capabilitiesFor };

export function can(
  user: Pick<SessionUser, 'role'>,
  cap: Capability,
): boolean {
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
