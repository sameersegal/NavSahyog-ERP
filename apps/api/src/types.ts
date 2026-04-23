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
  // JSON blob of KPI classification rules (see
  // requirements/kpi-rules.md). Parsed once per request; defaults
  // from @navsahyog/shared fill in any missing labels. Keeping this
  // as an env var (rather than a D1 table) matches the project-wide
  // rule that runtime tunables live out-of-DB — see CLAUDE.md.
  KPI_RULES_JSON?: string;
};

// The session-bound user — DB row shape, no computed capabilities.
// Routes read this from c.get('user'); serialisation (auth routes)
// is responsible for attaching capabilities before returning to
// the client.
export type SessionUser = BaseUser;

export type Variables = {
  user: SessionUser;
};
