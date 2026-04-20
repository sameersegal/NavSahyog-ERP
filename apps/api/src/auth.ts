import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { err } from './lib/errors';
import type { Bindings, SessionUser, Variables } from './types';

const SESSION_COOKIE = 'nsf_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(
  db: D1Database,
  userId: number,
): Promise<{ token: string; expiresAt: number }> {
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;
  await db
    .prepare(
      'INSERT INTO session (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(token, userId, expiresAt, now)
    .run();
  return { token, expiresAt };
}

export async function destroySession(
  db: D1Database,
  token: string,
): Promise<void> {
  await db.prepare('DELETE FROM session WHERE token = ?').bind(token).run();
}

export async function loadSessionUser(
  db: D1Database,
  token: string,
): Promise<SessionUser | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT u.id, u.user_id, u.full_name, u.role, u.scope_level, u.scope_id
       FROM session s JOIN user u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .bind(token, now)
    .first<SessionUser>();
  return row ?? null;
}

export const requireAuth: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return err(c, 'unauthenticated', 401);
  const user = await loadSessionUser(c.env.DB, token);
  if (!user) return err(c, 'unauthenticated', 401);
  c.set('user', user);
  await next();
};

export { SESSION_COOKIE, SESSION_TTL_SECONDS };

// `Secure` is required in production; without it the session
// cookie can travel over plain HTTP. Local dev runs over HTTP, so
// we leave it off there.
export function sessionCookieOptions(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  maxAgeSeconds: number,
) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
    secure: c.env.ENVIRONMENT === 'production',
  };
}
