import type { BaseUser, Role, ScopeLevel } from '@navsahyog/shared';

// Re-export the shared literals so callers inside the API don't
// need to know which package a name comes from. Single import site.
export type { Role, ScopeLevel };

export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  // Workers Static Assets fetcher. Bound via the top-level
  // `[assets]` block in wrangler.toml; used by the SPA fallback in
  // src/index.ts. Absent in the test harness — the fallback branch
  // already guards on presence.
  ASSETS?: Fetcher;
  // Comma-separated allowlist of origins that may make credentialed
  // cross-origin requests. Single-Worker same-origin deploys leave
  // this empty.
  ALLOWED_ORIGINS?: string;
  // 'development' | 'staging' | 'production'. Drives the `Secure`
  // cookie flag (non-dev gets Secure) and, for L2.4, the upload-
  // token signing default.
  ENVIRONMENT?: string;
  // HMAC secret for media upload tokens. Dev default lives in
  // wrangler.toml [vars]; non-dev MUST be set via
  // `wrangler secret put MEDIA_PRESIGN_SECRET`. Missing → 500 on
  // presign (fail-closed; see src/routes/media.ts).
  MEDIA_PRESIGN_SECRET?: string;
  // HTTP basic auth gate for the staging URL. Activated only when
  // BOTH are set via `wrangler secret put`. A no-op in dev / test.
  STAGING_BASIC_AUTH_USER?: string;
  STAGING_BASIC_AUTH_PASSWORD?: string;
  // Build-id of the deployed server (L4.0c — decisions.md D31).
  // CI sets this at deploy time; format `YYYY-MM-DD[.<sha>]`. Stamped
  // on every response as `X-Server-Build` so clients can detect a
  // newer deploy and surface the soft "Update available" banner.
  // Optional — when absent, the header isn't stamped and the soft
  // nudge stays dormant.
  SERVER_BUILD_ID?: string;
  // Compat floor for the build-id middleware (L4.0c — decisions.md
  // D31 deploy-grace fix). Format `YYYY-MM-DD[.<sha>]` — clients with
  // a build-date strictly older than this are 426'd. Operator sets
  // it on each deploy: typically to the *previous* deploy's build-id
  // so one-version-back keeps working; bump it to the current build
  // to force-upgrade the fleet (security-fix scenario). When unset,
  // no floor applies and any well-formed client build is accepted.
  MIN_SUPPORTED_BUILD?: string;
};

// The session-bound user — DB row shape, no computed capabilities.
// Routes read this from c.get('user'); serialisation (auth routes)
// is responsible for attaching capabilities before returning to
// the client.
export type SessionUser = BaseUser;

export type Variables = {
  user: SessionUser;
  // Build identity of the client that issued the request. Stamped by
  // the buildCompat middleware (apps/api/src/lib/build.ts) for every
  // non-carve-out path. `clientBuild` is the raw header value;
  // `clientBuildDate` is the parsed YYYY-MM-DD prefix or null when
  // the header is missing/malformed; `clientSchemaVersion` is reserved
  // for the L4.0b outbox-replay path. All three are absent on the
  // carve-out surfaces (`/health`, `/api/programs/*`, the token-gated
  // upload PUTs) — see src/lib/build.ts for the carve-out list.
  clientBuild?: string | null;
  clientBuildDate?: string | null;
  clientSchemaVersion?: string | null;
};
