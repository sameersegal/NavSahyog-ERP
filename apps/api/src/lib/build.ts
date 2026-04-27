// Build-id compat middleware (L4.0a — decisions.md D29, D31).
//
// Reads the `X-App-Build` header from inbound requests, parses the
// `YYYY-MM-DD[.suffix]` shape, and rejects clients past the N-7
// compat window with HTTP 426 + a JSON diagnostic. Anything that's
// in-window or malformed/missing falls through — `unknown_build`
// is treated as transitional (clients pre-dating L4.0a have no
// header). When every shipped client carries the header we'll flip
// the missing-header case to 426 too.
//
// The middleware only runs against authenticated API surfaces. Public
// or token-gated paths are carved out for the same reasons the
// staging gate carves them out (see src/index.ts).

import type { MiddlewareHandler } from 'hono';
import type { Bindings, Variables } from '../types';
import {
  BUILD_ID_HEADER,
  SCHEMA_VERSION_HEADER,
  checkCompat,
  parseBuildDate,
  todayIso,
} from '@navsahyog/shared';
import { err } from './errors';

// Paths that bypass the compat check. They either:
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

  const verdict = checkCompat(buildId, todayIso());
  if (verdict.kind === 'too_old') {
    return err(
      c,
      'upgrade_required',
      426,
      `Client build is ${verdict.days} days old; max supported window is 7 days. Refresh the app to upgrade.`,
    );
  }

  // `unknown_build` — header missing or malformed. Pass through for
  // now; flip to 426 once all deployed clients are stamping the
  // header (gate it on a Worker env var when that day comes).
  return next();
};
