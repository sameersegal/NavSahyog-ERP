// Build-id middleware family (L4.0a/c — decisions.md D29, D31).
//
// Two concerns, two middlewares:
//
//  * `buildCompat` (request gate): reads `X-App-Build` from the
//    inbound request and 426s clients older than `MIN_SUPPORTED_BUILD`.
//    The floor is operator-managed (typically set to the *previous*
//    deploy's build-id at deploy time so one-version-back keeps
//    working). When the env var is unset there is no floor and any
//    well-formed client build is accepted. This intentionally is
//    **not** wall-clock-based — comparing client build to "today"
//    would 426 every existing client the moment a new build deploys.
//
//  * `serverBuildStamp` (response stamp): adds `X-Server-Build` to
//    every response so clients can detect a newer deploy and surface
//    the soft "Update available" banner. Independent of the gate —
//    runs even on the carve-out paths so even unauthenticated clients
//    learn the deploy version.
//
// The middleware only runs `buildCompat` against authenticated API
// surfaces; the staging gate's carve-outs apply (public surfaces,
// upload PUTs, /health).

import type { MiddlewareHandler } from 'hono';
import type { Bindings, Variables } from '../types';
import {
  BUILD_ID_HEADER,
  SCHEMA_VERSION_HEADER,
  SERVER_BUILD_HEADER,
  checkFloor,
  parseBuildDate,
} from '@navsahyog/shared';
import { err } from './errors';

// Paths that bypass the compat check (not the response stamp). They
// either:
//   * answer to platform probes that must always succeed (`/health`),
//   * are public, no-auth surfaces consumed by third parties that we
//     can't force to ship a build-id header (`/api/programs/*`),
//   * are HMAC-token-gated upload PUTs that don't carry app
//     credentials at all and run their own auth (`/api/media/upload/*`,
//     `/api/ponds/agreements/upload/*`).
function isCarveOut(path: string): boolean {
  if (path === '/health') return true;
  if (path.startsWith('/api/programs/')) return true;
  if (path.startsWith('/api/media/upload/')) return true;
  if (path.startsWith('/api/ponds/agreements/upload/')) return true;
  return false;
}

export const buildCompat: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (isCarveOut(path)) return next();

  const buildId = c.req.header(BUILD_ID_HEADER) ?? null;
  const schemaVersion = c.req.header(SCHEMA_VERSION_HEADER) ?? null;

  // Stash the parsed build on the context so route handlers and
  // future observability can see what shipped the request without
  // re-parsing the header.
  c.set('clientBuild', buildId);
  c.set('clientBuildDate', parseBuildDate(buildId));
  c.set('clientSchemaVersion', schemaVersion);

  const minSupported = c.env.MIN_SUPPORTED_BUILD ?? null;
  const verdict = checkFloor(buildId, minSupported);
  if (verdict.kind === 'too_old') {
    return err(
      c,
      'upgrade_required',
      426,
      `Client build is ${verdict.days} days behind the supported floor (${minSupported}). Refresh the app to upgrade.`,
    );
  }

  // `unknown_build` (header missing or malformed) is transitional —
  // pass through. Once all shipped clients carry the header, this
  // case can flip to 426 too (gated behind another env var when
  // that day comes).
  return next();
};

// Stamps `X-Server-Build` on every response when SERVER_BUILD_ID is
// set. Runs ahead of the route handler so the header lands on
// successful and error responses alike.
export const serverBuildStamp: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> = async (c, next) => {
  await next();
  const buildId = c.env.SERVER_BUILD_ID;
  if (buildId) c.header(SERVER_BUILD_HEADER, buildId);
};
