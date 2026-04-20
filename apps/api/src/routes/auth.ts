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
import type { Bindings, SessionUser, Variables } from '../types';

type LoginBody = { user_id?: string; password?: string };

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

auth.post('/login', async (c) => {
  const body = await c.req.json<LoginBody>().catch(() => ({}) as LoginBody);
  const userId = body.user_id?.trim();
  const password = body.password ?? '';
  if (!userId || !password) {
    return c.json({ error: 'user_id and password required' }, 400);
  }
  const user = await c.env.DB.prepare(
    `SELECT id, user_id, full_name, role, scope_level, scope_id
     FROM user WHERE user_id = ? AND password = ?`,
  )
    .bind(userId, password)
    .first<SessionUser>();
  if (!user) return c.json({ error: 'invalid credentials' }, 401);
  const { token } = await createSession(c.env.DB, user.id);
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SECONDS));
  return c.json({ user });
});

auth.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.env.DB, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

auth.get('/me', requireAuth, async (c) => {
  return c.json({ user: c.get('user') });
});

export default auth;
