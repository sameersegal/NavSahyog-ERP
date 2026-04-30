# identity

Authentication and user provisioning.

- Routes: [`apps/api/src/routes/auth.ts`](../../../apps/api/src/routes/auth.ts),
  [`apps/api/src/routes/webhooks_clerk.ts`](../../../apps/api/src/routes/webhooks_clerk.ts),
  [`apps/api/src/routes/users.ts`](../../../apps/api/src/routes/users.ts)
- Spec: §3.1 (Authentication), §3.8.7 (Master Creations — users),
  D36 in [`decisions.md`](../../decisions.md)
- Capability source: `packages/shared/src/capabilities.ts`

## Invariants

- **Role determines `scope_level` uniquely.** Pinned server-side
  via `SCOPE_FOR_ROLE` in users.ts. The create form picks role +
  scope_id; the level is derived. There is no UI path that lets
  the two diverge.
- **Capabilities are computed from role server-side.** The wire
  payload from `/auth/login`, `/auth/exchange`, and `/auth/me`
  carries `user.capabilities` — a serialized snapshot for the
  client to hide UI. The server is still authoritative; client
  never maintains its own role → capability matrix.
- **Sessions live in D1.** Cookie-based, TTL `SESSION_TTL_SECONDS`.
  Outbox drain re-prompts on session expiry — covered in
  `mvp/level-4.md` watch-out.
- **Clerk identity ↔ local user is matched strictly by
  `clerk_user_id`.** `/auth/exchange` verifies the inbound Clerk
  JWT, looks up `user WHERE clerk_user_id = ?`, mints the cookie
  if found, returns `403 user_not_provisioned` otherwise. There
  is no email-based self-heal on the request path — that would
  let anyone signing into Clerk with a privileged user's email
  silently take over the local row.

## How a new user is provisioned

The `/webhooks/clerk` endpoint is the single provisioning path
for new local rows. Admin creates the user in the Clerk
dashboard (or via Clerk's Backend API); Clerk fires `user.created`;
the Svix-verified webhook handler INSERTs a local row carrying:

- `clerk_user_id` — the Clerk-side identifier (stable, unique).
- `email` — primary email from the payload.
- `full_name` — `first_name + last_name`, falling back to the
  email local-part, then to the Clerk id.
- `user_id` — the Clerk id (legacy login handle is unused; admin
  can rename via PATCH at promotion time).
- `password` — empty string. The column is vestigial on the
  Clerk path; `/auth/login` won't accept an empty value.
- `role = 'pending'`, `scope_level = 'pending'`, `scope_id = NULL`.

`pending` is a sentinel: capabilities.ts maps it to `[]` and
`scope.ts` resolves it to an empty village set, so a freshly
provisioned user can sign in but cannot read or write anything.
Admin promotes the row by PATCHing `/api/users/:id` with a real
role + scope_id. The role picker in the Masters UI is driven by
`ROLES`, which omits `pending` — admin can never select it.

`user.updated` refreshes `email`, `full_name`, and
`clerk_synced_at` on the linked row. Role / scope_level /
scope_id are never touched here — admin owns them, and a Clerk-
side profile edit must not silently re-grant or revoke
capabilities.

`user.deleted` drops every active session for the row and nulls
`clerk_user_id`. The local row stays so audit-trail FKs
(`created_by` on students, attendance, ponds, etc.) keep
resolving.

## Lifecycle gotchas

- **Default password is `'password'`** for legacy users created
  via the Masters UI (D24). New rows from the webhook carry an
  empty password — `/auth/login` won't accept it, so the only
  way for those users to sign in is via Clerk.
- **Race between sign-in and webhook delivery.** Clerk delivers
  webhooks asynchronously, and `/auth/exchange` does not wait.
  If the very first sign-in races ahead of `user.created`, the
  exchange returns `403 user_not_provisioned`; the user retries
  a moment later and it succeeds. This is the trade-off of
  removing the email self-heal — clearer security boundary, one
  occasional retry on the first sign-in immediately after admin
  provisions the Clerk account.
- **The `password` column stays in the schema until L5.** Clerk
  either drops it or repurposes it for `clerk_user_id`. Any
  hashing / password policy work before L5 would be ripped out.

## Cross-context coupling

- **Every other context's `requireAuth` / `requireCap` middleware
  reads the session set up here.** Auth isn't optional; only the
  public surfaces (`POST /auth/login`, `POST /auth/exchange`,
  `POST /auth/logout`, `POST /webhooks/clerk`, HMAC-token-gated
  upload PUTs in media + ponds, public embed GETs in programs)
  bypass it.
