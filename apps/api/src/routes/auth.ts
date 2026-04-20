import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
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

type LoginBody = { user_id?: string; password?: string };

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
