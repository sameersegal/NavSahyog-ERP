// /webhooks/clerk — D36 step 3.
//
// Receives Svix-signed webhooks from Clerk and is the single
// provisioning path for new local user rows. The auth flow
// (/auth/exchange) matches strictly by `clerk_user_id`, so
// linking a Clerk account to a local row is exactly "the row
// exists with that clerk_user_id". The webhook owns that.
//
// Role/scope assignment is *not* the webhook's job — admin does
// that via Masters → Users (PATCH /api/users/:id). New rows land
// with role='pending' / scope_level='pending' / scope_id=NULL,
// which capabilities.ts maps to the empty capability set, so a
// pending user can sign in but cannot read or write anything
// until promoted.
//
//   user.created  → INSERT a local row with clerk_user_id, email,
//                   full_name from the Clerk payload and the
//                   pending role/scope sentinel.
//   user.updated  → refresh email + full_name + clerk_synced_at on
//                   the already-linked row. Role/scope/scope_id are
//                   never touched here — admin owns them.
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

type ClerkEmailAddress = {
  id: string;
  email_address: string;
};

type ClerkUserPayload = {
  id: string;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type ClerkEvent =
  | { type: 'user.created'; data: ClerkUserPayload }
  | { type: 'user.updated'; data: ClerkUserPayload }
  | { type: 'user.deleted'; data: { id: string } }
  | { type: string; data: unknown };

const FIVE_MINUTES = 5 * 60;

function primaryEmail(payload: ClerkUserPayload): string | null {
  const emails = payload.email_addresses ?? [];
  const primaryId = payload.primary_email_address_id;
  const primary = primaryId
    ? emails.find((e) => e.id === primaryId)
    : emails[0];
  return primary?.email_address.toLowerCase() ?? null;
}

// Best-effort display name. Falls back to email local-part, then to
// the Clerk id — the row has to satisfy the NOT NULL constraint and
// admin will edit it during promotion anyway.
function displayName(payload: ClerkUserPayload, email: string | null): string {
  const first = (payload.first_name ?? '').trim();
  const last = (payload.last_name ?? '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (email) return email.split('@')[0]!;
  return payload.id;
}

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
    case 'user.created': {
      const data = event.data as ClerkUserPayload;
      const email = primaryEmail(data);
      const fullName = displayName(data, email);
      // user_id is the legacy login handle from /auth/login. With
      // Clerk owning sign-in, new rows don't need a separate
      // human-typed handle — using the Clerk id keeps it unique
      // and stable. Admin can rename via PATCH /api/users/:id at
      // promotion time if a friendlier handle is wanted.
      //
      // password is NOT NULL on the schema (vestigial; see the
      // 0011 migration comment). Empty string is the sentinel for
      // "Clerk-managed, no local password" — /auth/login won't
      // accept it because parseAdminBody requires a non-empty
      // body.password and the seed default is 'password'.
      //
      // INSERT OR IGNORE on the (unique) clerk_user_id index makes
      // duplicate webhook deliveries safe.
      const inserted = await c.env.DB.prepare(
        `INSERT OR IGNORE INTO user (
            user_id, full_name, password, role, scope_level,
            scope_id, created_at, clerk_user_id, clerk_synced_at, email
          )
          VALUES (?, ?, '', 'pending', 'pending', NULL, unixepoch(), ?, unixepoch(), ?)`,
      )
        .bind(data.id, fullName, data.id, email)
        .run();
      return c.json({ ok: true, created: inserted.meta.changes > 0 });
    }
    case 'user.updated': {
      const data = event.data as ClerkUserPayload;
      const email = primaryEmail(data);
      const fullName = displayName(data, email);
      // Refresh email + full_name + clerk_synced_at on the linked
      // row. Role / scope_level / scope_id are intentionally not
      // touched — admin owns those via /api/users PATCH.
      const synced = await c.env.DB.prepare(
        `UPDATE user
           SET email = ?, full_name = ?, clerk_synced_at = unixepoch()
         WHERE clerk_user_id = ?`,
      )
        .bind(email, fullName, data.id)
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
