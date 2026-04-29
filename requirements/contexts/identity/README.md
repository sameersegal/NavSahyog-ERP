# identity

Authentication and user provisioning.

- Routes: [`apps/api/src/routes/auth.ts`](../../../apps/api/src/routes/auth.ts),
  [`apps/api/src/routes/users.ts`](../../../apps/api/src/routes/users.ts)
- Spec: §3.1 (Authentication), §3.8.7 (Master Creations — users)
- Capability source: `packages/shared/src/capabilities.ts`

## Invariants

- **Role determines `scope_level` uniquely.** Pinned server-side
  via `SCOPE_FOR_ROLE` in users.ts. The create form picks role +
  scope_id; the level is derived. There is no UI path that lets
  the two diverge.
- **Capabilities are computed from role server-side.** The wire
  payload from `/auth/login` and `/auth/me` carries
  `user.capabilities` — a serialized snapshot for the client to
  hide UI. The server is still authoritative; client never
  maintains its own role → capability matrix.
- **Sessions live in D1.** Cookie-based, TTL `SESSION_TTL_SECONDS`.
  Outbox drain re-prompts on session expiry — covered in
  `mvp/level-4.md` watch-out.

## Lifecycle gotchas

- **Default password is `'password'`** for newly-created users
  (D24). There is no password change UI. Out-of-band reset is the
  only path to a different value until Clerk lands at L5.
- **The `password` column stays in the schema until L5.** Clerk
  either drops it or repurposes it for `clerk_user_id`. Any
  hashing / password policy work before L5 would be ripped out.

## Cross-context coupling

- **Every other context's `requireAuth` / `requireCap` middleware
  reads the session set up here.** Auth isn't optional; only the
  three public surfaces (`POST /auth/login`, `POST /auth/logout`,
  HMAC-token-gated upload PUTs in media + ponds, public embed
  GETs in programs) bypass it.
