# Staging deploy — runbook

Demo URL for the broader team, gated by HTTP basic auth. Minimum
Cloudflare surface: one Worker (api + bundled web bundle via Workers
Static Assets), one D1 database, one R2 bucket. No Pages project, no
Queues, no KV, no Cloudflare Images.

Same-origin serving resolves the cross-origin cookie + relative-
media-URL issues flagged on PR #26.

## Prerequisites

- Cloudflare account with Workers + D1 + R2 enabled.
- Authenticated wrangler — either:
  - interactive: `wrangler login`, or
  - CI/agent: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env
    vars. Tokens need **Edit Workers + D1 Edit + R2 Edit** scopes.
- pnpm workspace bootstrapped: `pnpm install --frozen-lockfile`.

## One-time Cloudflare resources

```bash
wrangler d1 create navsahyog-staging
# → paste the database_id into apps/api/wrangler.toml under
#   [[env.staging.d1_databases]] if it differs from the committed id.

wrangler r2 bucket create media-staging
```

The repo already pins `database_id = "7ceed522-7379-47ff-a9e6-0b6d638c4865"`.
If you recreate the database in a different account, update that line.

## One-time secrets (from `apps/api/`)

```bash
# HMAC signing key for upload tokens (§5.8, decisions.md D7).
# 32 random bytes, base64-urlencoded, never rotated casually —
# invalidates all in-flight upload tokens.
wrangler secret put MEDIA_PRESIGN_SECRET --env staging

# Optional staging gate. Both must be set for the basic-auth
# middleware to activate; leaving either unset = no outer gate,
# which is fine only if you've rotated the seed passwords.
wrangler secret put STAGING_BASIC_AUTH_USER --env staging
wrangler secret put STAGING_BASIC_AUTH_PASSWORD --env staging
```

The GitHub Actions workflow (`.github/workflows/deploy-staging.yml`)
sets `MEDIA_PRESIGN_SECRET` on every deploy from the
`CF_STAGING_MEDIA_PRESIGN_SECRET` GitHub secret, so running the CLI
command above is only needed when you don't want CI to drive
deploys.

## Build + migrate + deploy

```bash
# Web bundle → apps/web/dist/  (Workers Static Assets directory)
pnpm --filter @navsahyog/web build

cd apps/api

# Schema on remote D1.
wrangler d1 migrations apply navsahyog-staging --remote --env staging

# Seed — one-off on first deploy only. Re-running overwrites rows
# but is idempotent (seed leads with DELETE FROM).
wrangler d1 execute navsahyog-staging --remote \
  --file=../../db/seed.sql --env staging

# Ship it.
wrangler deploy --env staging
```

Expect a URL like `https://navsahyog-api-staging.<your-subdomain>.workers.dev/`.
Browse there: basic-auth prompt (if set), then the React app.
Seed users: `super / password`, `vc-anandpur / password`, etc.

## GitHub Actions

`.github/workflows/deploy-staging.yml` triggers on push to `main` and
on `workflow_dispatch`. Required repo secrets:

| Secret | Used for |
|---|---|
| `CLOUDFLARE_API_TOKEN` | `wrangler deploy` + `wrangler d1 …` + `wrangler secret put` |
| `CLOUDFLARE_ACCOUNT_ID` | Targets the right account |
| `CF_STAGING_MEDIA_PRESIGN_SECRET` | Piped into `wrangler secret put MEDIA_PRESIGN_SECRET --env staging` on every deploy |

If you want the staging URL gated by basic auth, set
`STAGING_BASIC_AUTH_USER` + `STAGING_BASIC_AUTH_PASSWORD` once via
`wrangler secret put` (the CI workflow doesn't touch them).

## Rotating the basic-auth password

```bash
cd apps/api
wrangler secret put STAGING_BASIC_AUTH_PASSWORD --env staging
```

Takes effect on the next request.

## Smoke test (5 minutes)

1. Log in as `super` → land on Home with all 3 villages.
2. `/village/1` → Children tab → **Add child** with photo (small
   JPG from the camera roll). Verify the thumbnail renders on the
   list afterwards.
3. Attendance tab → **New session** → **Record** voice note → stop
   → Save. Verify the session list shows it.
4. `/capture` → Photo mode → Select file → upload. Switch to
   **Audio** mode (Record button should appear).
5. `/dashboard` → Children tile → drill through zones to the
   Anandpur village-leaf row. Click **Download CSV**.
6. Log out → log back in as `district-bid` (district admin) → the
   same dashboard works; the **Add child** button is gone.

## Teardown

```bash
cd apps/api
wrangler delete --env staging
wrangler d1 delete navsahyog-staging
wrangler r2 bucket delete media-staging
```

## Known gaps (pre-prod, not blockers for the demo)

- Media bytes transit the Worker (`/api/media/upload/:uuid`). Fine
  at the 50 MiB cap for lab use; violates §8.13 budget. Fix is
  `mvp/level-2.4b.md` P3.1 — AWS4 presigned URLs direct to R2.
- Plain-text passwords in `db/seed.sql`. Rotate them (or wipe the
  seed + add users via SQL) before the URL becomes discoverable
  outside the invited team. Hardened auth lands in L5.
- No derived thumbnails (`media-derive` queue is L2.4b P2.1); list
  endpoints serve originals, which is wasteful on bandwidth but
  functionally correct.
