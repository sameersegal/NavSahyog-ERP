import type { BaseUser, Role, ScopeLevel } from '@navsahyog/shared';

// Re-export the shared literals so callers inside the API don't
// need to know which package a name comes from. Single import site.
export type { Role, ScopeLevel };

export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  // Comma-separated allowlist of origins that may make credentialed
  // requests. Set in wrangler.toml [vars]. Empty / unset means
  // same-origin only (the Vite dev proxy + the deployed Pages site).
  ALLOWED_ORIGINS?: string;
  // 'development' | 'production'. Drives the `Secure` cookie flag
  // and, for L2.4, the upload-token signing default.
  ENVIRONMENT?: string;
  // HMAC secret for media upload tokens. Dev default lives in
  // wrangler.toml [vars]; production must be set via
  // `wrangler secret put MEDIA_PRESIGN_SECRET`.
  MEDIA_PRESIGN_SECRET?: string;
};

// The session-bound user — DB row shape, no computed capabilities.
// Routes read this from c.get('user'); serialisation (auth routes)
// is responsible for attaching capabilities before returning to
// the client.
export type SessionUser = BaseUser;

export type Variables = {
  user: SessionUser;
};
