import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import villages from './routes/villages';
import schools from './routes/schools';
import children from './routes/children';
import events from './routes/events';
import attendance from './routes/attendance';
import achievements from './routes/achievements';
import media from './routes/media';
import dashboard from './routes/dashboard';
import insights from './routes/insights';
import streaks from './routes/streaks';
import geo from './routes/geo';
import qualifications from './routes/qualifications';
import trainingManuals from './routes/training_manuals';
import users from './routes/users';
import ponds from './routes/ponds';
import programs from './routes/programs';
import { buildCompat, serverBuildStamp } from './lib/build';
import { err } from './lib/errors';
import type { Bindings, Variables } from './types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Staging gate — HTTP basic auth, activated only when both
// STAGING_BASIC_AUTH_USER and STAGING_BASIC_AUTH_PASSWORD secrets
// are set (via `wrangler secret put`). Deliberately a no-op in dev
// and in test so the local flow stays trivial. Skips:
//   * /health               — platform liveness probe must answer 200.
//   * /api/media/upload/:uuid — already token-gated by the HMAC in
//     the query string; layering basic auth on top of that would
//     break the presigned-URL model that assumes no session cookie
//     travels with the upload.
//
// This is the *outer* gate for a public staging URL; the app's own
// `/auth/login` + session cookie still gates application access.
app.use('*', async (c, next) => {
  const user = c.env.STAGING_BASIC_AUTH_USER;
  const pass = c.env.STAGING_BASIC_AUTH_PASSWORD;
  if (!user || !pass) return next();

  const path = new URL(c.req.url).pathname;
  if (path === '/health') return next();
  if (path.startsWith('/api/media/upload/')) return next();
  // Same carve-out for the agreement upload endpoint — already
  // token-gated by the HMAC in the query string.
  if (path.startsWith('/api/ponds/agreements/upload/')) return next();
  // Public, embeddable program APIs (no auth, PII-scrubbed). These
  // are designed to be called cross-origin from third-party sites,
  // so they cannot live behind the staging basic-auth gate.
  if (path.startsWith('/api/programs/')) return next();

  const header = c.req.header('authorization') ?? '';
  const match = /^Basic (.+)$/i.exec(header);
  const REALM = 'NavSahyog staging';
  if (!match) {
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` },
    });
  }
  let decoded: string;
  try {
    decoded = atob(match[1]!);
  } catch {
    return new Response('Bad authorization header', { status: 400 });
  }
  const colon = decoded.indexOf(':');
  const gotUser = colon < 0 ? decoded : decoded.slice(0, colon);
  const gotPass = colon < 0 ? '' : decoded.slice(colon + 1);
  if (gotUser !== user || gotPass !== pass) {
    return new Response('Invalid credentials', {
      status: 401,
      headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` },
    });
  }
  return next();
});

// CORS — two regimes, picked per-request by path:
//
//   * `/api/programs/*` is an embeddable, no-auth, no-cookie public
//     surface. Any origin can read it, so we return ACAO `*` and
//     refuse credentials. Restricted to GET + OPTIONS so the surface
//     stays read-only at the CORS layer too.
//
//   * Everything else is the credentialed app API. Origin must
//     appear in ALLOWED_ORIGINS (comma-separated Worker var); the
//     browser refuses the request otherwise. Same-origin callers
//     carry no `Origin` header and are unaffected. Single-Worker
//     same-origin deploys leave ALLOWED_ORIGINS empty so any stray
//     cross-origin caller is refused by default.
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/programs/')) {
    return cors({
      origin: '*',
      credentials: false,
      allowHeaders: ['Content-Type'],
      allowMethods: ['GET', 'OPTIONS'],
    })(c, next);
  }
  const allowed = (c.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })(c, next);
});

// Stamp `X-Server-Build` on every response (L4.0c — decisions.md D31
// deploy-grace fix). Runs unconditionally — even the carve-out
// surfaces stamp the header so clients on those paths still learn
// when a new build deploys. Registered before any route handler so
// the middleware actually wraps every responder including /health.
app.use('*', serverBuildStamp);

// Build-id compat gate (L4.0a/c — decisions.md D31). Applies to
// authenticated API surfaces only; carve-outs match the staging
// gate (see src/lib/build.ts). Returns 426 only when the client
// build is older than `MIN_SUPPORTED_BUILD` — operator-managed
// floor, not wall-clock-based.
app.use('*', buildCompat);

// Liveness. The old `/` JSON ping moved here so `/` falls through
// to Workers Static Assets (the web bundle's index.html).
app.get('/health', (c) => c.json({ ok: true, service: 'navsahyog-api' }));

app.route('/auth', auth);
app.route('/api/villages', villages);
app.route('/api/schools', schools);
app.route('/api/children', children);
app.route('/api/events', events);
app.route('/api/attendance', attendance);
app.route('/api/achievements', achievements);
app.route('/api/media', media);
app.route('/api/dashboard', dashboard);
app.route('/api/insights', insights);
app.route('/api/streaks', streaks);
app.route('/api/geo', geo);
app.route('/api/qualifications', qualifications);
app.route('/api/training-manuals', trainingManuals);
app.route('/api/users', users);
app.route('/api/ponds', ponds);
app.route('/api/programs', programs);

app.onError((e, c) => {
  console.error(e);
  return err(c, 'internal_error', 500, e.message);
});

// API / auth paths 404 as JSON; anything else is treated as a SPA
// route and served the bundle's index.html via the ASSETS binding
// so the React router can take over. Doing the SPA fallback in the
// Worker (instead of `not_found_handling = "single-page-application"`
// in wrangler.toml) avoids a platform-level interception that would
// otherwise turn `/api/unknown` into index.html too.
app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/') || path.startsWith('/auth/') || path === '/health') {
    return err(c, 'not_found', 404);
  }
  if (!c.env.ASSETS) return err(c, 'not_found', 404);
  const rootUrl = new URL('/', c.req.url);
  return c.env.ASSETS.fetch(new Request(rootUrl, c.req.raw));
});

export default app;
