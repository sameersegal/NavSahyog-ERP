// /webhooks/clerk — D36 step 3.
//
// Receives Svix-signed webhooks from Clerk. The handler never
// creates or auto-links rows — `clerk_user_id` is provisioned
// out-of-band (seed-clerk.mjs or admin tooling) so the auth flow
// never has to trust Clerk-supplied email matching, and a Clerk
// account on a privileged user's email can't silently take it over.
//
//   user.created  → no-op (link comes from out-of-band provisioning).
//                   Acknowledged so Clerk stops retrying.
//   user.updated  → re-stamp clerk_synced_at on the already-linked
//                   row, if any. Never establishes a new link.
//   user.deleted  → invalidate sessions and unlink. The local row
//                   stays so audit-trail FKs still resolve.
//
// Svix verification is inlined (HMAC-SHA256 over
// `<svix-id>.<svix-timestamp>.<raw-body>`). The svix SDK would do
// the same thing with a 200kB+ dependency tree; the bespoke
// principle in CLAUDE.md says drop platform-generic complexity.
//
// Carve-outs — the route is added to the staging-basic-auth and
// buildCompat carve-out lists in src/index.ts and src/lib/build.ts:
// Clerk's webhook caller can't carry basic-auth or X-App-Build.

import { Hono } from 'hono';
import { err } from '../lib/errors';
import type { Bindings, Variables } from '../types';
import type { RouteMeta } from '../lib/route-meta';

// Walked by scripts/gen-matrix.mjs.
export const meta: RouteMeta = {
  context: 'identity',
  resource: 'webhooks/clerk',
  cra: 'create-only',
  offline: { write: 'online-only' },
  refs: ['D36'],
};

type ClerkUserPayload = {
  id: string;
};

type ClerkEvent =
  | { type: 'user.created'; data: ClerkUserPayload }
  | { type: 'user.updated'; data: ClerkUserPayload }
  | { type: 'user.deleted'; data: { id: string } }
  | { type: string; data: unknown };

const FIVE_MINUTES = 5 * 60;

// Constant-time string compare so a timing attack on the signature
// can't recover bytes. The Web Crypto subtle API doesn't expose a
// direct comparator, so we walk the strings ourselves.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySvixSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  body: string,
  signatureHeader: string,
): Promise<boolean> {
  // Svix secrets have the form `whsec_<base64-secret>`. The key bytes
  // are the base64-decoded payload after the prefix.
  const trimmed = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const keyBytes = Uint8Array.from(atob(trimmed), (ch) => ch.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = `${svixId}.${svixTimestamp}.${body}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message)),
  );
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  const expected = btoa(binary);

  // The header may carry multiple signatures separated by spaces, each
  // prefixed with a version (`v1,<base64>`). Any matching v1 entry is
  // sufficient — Svix rotates by appending, not by removing.
  for (const candidate of signatureHeader.split(' ')) {
    const [version, sig] = candidate.split(',');
    if (version === 'v1' && sig && timingSafeEqual(sig, expected)) return true;
  }
  return false;
}

const webhooks = new Hono<{ Bindings: Bindings; Variables: Variables }>();

webhooks.post('/clerk', async (c) => {
  if (!c.env.CLERK_WEBHOOK_SECRET) {
    return err(c, 'internal_error', 500, 'CLERK_WEBHOOK_SECRET unset');
  }
  const svixId = c.req.header('svix-id');
  const svixTimestamp = c.req.header('svix-timestamp');
  const svixSignature = c.req.header('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return err(c, 'bad_request', 400, 'missing svix headers');
  }
  // Drop stale events outside a ±5 minute window. Defends against
  // replay of a captured signed payload long after the fact.
  const now = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(svixTimestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > FIVE_MINUTES) {
    return err(c, 'bad_request', 400, 'stale or invalid svix-timestamp');
  }

  const rawBody = await c.req.text();
  const ok = await verifySvixSignature(
    c.env.CLERK_WEBHOOK_SECRET,
    svixId,
    svixTimestamp,
    rawBody,
    svixSignature,
  );
  if (!ok) return err(c, 'unauthenticated', 401, 'invalid svix signature');

  let event: ClerkEvent;
  try {
    event = JSON.parse(rawBody) as ClerkEvent;
  } catch {
    return err(c, 'bad_request', 400, 'invalid json');
  }

  switch (event.type) {
    case 'user.created':
      // Provisioning is out-of-band; the webhook never creates a
      // link. Acknowledge so Clerk stops retrying.
      return c.json({ ok: true, linked: false });
    case 'user.updated': {
      const data = event.data as ClerkUserPayload;
      // Re-stamp clerk_synced_at on the row that was provisioned
      // out-of-band against this Clerk id. No-op if no such row.
      const synced = await c.env.DB.prepare(
        `UPDATE user
           SET clerk_synced_at = unixepoch()
         WHERE clerk_user_id = ?`,
      )
        .bind(data.id)
        .run();
      return c.json({ ok: true, synced: synced.meta.changes > 0 });
    }
    case 'user.deleted': {
      const data = event.data as { id: string };
      const local = await c.env.DB.prepare(
        'SELECT id FROM user WHERE clerk_user_id = ?',
      )
        .bind(data.id)
        .first<{ id: number }>();
      if (!local) return c.json({ ok: true, deleted: false });
      // Drop active sessions so the user is signed out everywhere on
      // next request. The local user row stays — `created_by` FKs on
      // students / achievements / ponds reference it and must keep
      // resolving for the audit trail.
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM session WHERE user_id = ?').bind(local.id),
        c.env.DB.prepare('UPDATE user SET clerk_user_id = NULL WHERE id = ?').bind(local.id),
      ]);
      return c.json({ ok: true, deleted: true });
    }
    default:
      // Unhandled event types are 200'd so Clerk stops retrying. New
      // events Clerk adds in future (e.g. `email.created`) shouldn't
      // back up its delivery queue.
      return c.json({ ok: true, ignored: event.type });
  }
});

export default webhooks;
