import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { verifyToken } from '@clerk/backend';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSession,
  destroySession,
  requireAuth,
  sessionCookieOptions,
} from '../auth';
import { capabilitiesFor } from '../policy';
import { err } from '../lib/errors';
import type { Bindings, SessionUser, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

type LoginBody = { user_id?: string; password?: string };
type ExchangeBody = { token?: string };

// Walked by scripts/gen-matrix.mjs.
export const meta: RouteMeta = {
  context: 'identity',
  resource: 'auth',
  cra: 'create-only',
  offline: { write: 'online-only', read: 'online-only' },
  refs: ['§3.1'],
};

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Send the user's capability list alongside their profile. The web
// client hides UI for actions a role can't do; the server still
// enforces, so this is UX-only. Single source of truth is
// policy.ts — client never maintains its own role matrix.
function serialiseUser(user: SessionUser) {
  return { ...user, capabilities: capabilitiesFor(user.role) };
}

auth.post('/login', async (c) => {
  const body = await c.req.json<LoginBody>().catch(() => ({}) as LoginBody);
  const userId = body.user_id?.trim();
  const password = body.password ?? '';
  if (!userId || !password) {
    return err(c, 'bad_request', 400, 'user_id and password required');
  }
  const user = await c.env.DB.prepare(
    `SELECT id, user_id, full_name, role, scope_level, scope_id
     FROM user WHERE user_id = ? AND password = ?`,
  )
    .bind(userId, password)
    .first<SessionUser>();
  if (!user) return err(c, 'unauthenticated', 401, 'invalid credentials');
  const { token } = await createSession(c.env.DB, user.id);
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(c, SESSION_TTL_SECONDS));
  return c.json({ user: serialiseUser(user) });
});

// D36 step 2 — bridge layer 1 (Clerk identity) into layer 2 (Worker
// authz). The client signs in with Clerk, calls /auth/exchange with
// the resulting session JWT, and gets back the same long-lived
// nsf_session cookie that /auth/login mints. After this point the
// rest of the app is unchanged: every API request rides on the
// cookie, the Worker never talks to Clerk again until the cookie
// expires, and offline survives the full 30-day TTL.
//
// Lookup is strictly by `clerk_user_id`. Linking happens out-of-band
// (seed-clerk.mjs at provision time, or admin tooling that creates
// the Clerk user and writes the id back). The exchange path never
// matches by email — that would let anyone signing into Clerk with
// a privileged user's email take over the local row.
//
// 403 user_not_provisioned → no local row carries this Clerk id.
// Admin has to provision the mapping first.
auth.post('/exchange', async (c) => {
  if (!c.env.CLERK_SECRET_KEY) {
    return err(c, 'internal_error', 500, 'CLERK_SECRET_KEY unset');
  }
  const body = await c.req.json<ExchangeBody>().catch(() => ({}) as ExchangeBody);
  const clerkToken = body.token?.trim();
  if (!clerkToken) {
    return err(c, 'bad_request', 400, 'token required');
  }
  let clerkUserId: string;
  try {
    const claims = await verifyToken(clerkToken, {
      secretKey: c.env.CLERK_SECRET_KEY,
    });
    clerkUserId = String(claims.sub ?? '');
    if (!clerkUserId) {
      return err(c, 'unauthenticated', 401, 'token missing sub claim');
    }
  } catch {
    return err(c, 'unauthenticated', 401, 'invalid clerk token');
  }

  const user = await c.env.DB.prepare(
    `SELECT id, user_id, full_name, role, scope_level, scope_id
     FROM user WHERE clerk_user_id = ?`,
  )
    .bind(clerkUserId)
    .first<SessionUser>();

  if (!user) {
    return err(c, 'forbidden', 403, 'user_not_provisioned');
  }

  const { token } = await createSession(c.env.DB, user.id);
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(c, SESSION_TTL_SECONDS));
  return c.json({ user: serialiseUser(user) });
});

auth.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.env.DB, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

auth.get('/me', requireAuth, async (c) => {
  return c.json({ user: serialiseUser(c.get('user')) });
});

export default auth;
