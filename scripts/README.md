# scripts/

Repo-level utility scripts. Each is single-purpose; no framework.

## `nsf-auth.mjs` — CLI sign-in for skills + ad-hoc curl

Loopback OAuth-style helper that mirrors the `gh auth login` /
`wrangler login` UX. Run once, get a 30-day cookie persisted to
`~/.nsf/credentials`.

```bash
# local dev — backend at 127.0.0.1:8787, web at localhost:5173
node scripts/nsf-auth.mjs

# staging — outer basic-auth in front of /auth/exchange, plus the
# Worker URL and the web origin where Clerk's <SignIn /> renders
node scripts/nsf-auth.mjs \
  --web=https://<web-staging> \
  --api=https://navsahyog-api-staging.sameersegal.workers.dev \
  --basic-auth=<user>:<pass>
```

Mechanics: spins up a one-shot HTTP listener on a random
`127.0.0.1` port, opens the operator's browser to
`<web>/cli-auth?return_to=…&state=…`, the page renders Clerk's
`<SignIn />` (or skips it if already signed in), mints a Clerk
session JWT via `getToken()`, and redirects back to the loopback
with the JWT in the query string. The CLI then posts the JWT to
`/auth/exchange`, captures the `Set-Cookie: nsf_session=…`, and
writes credentials to disk (mode 0600). Layers 2-4 of D36 are
unchanged.

### Loading the session into env vars

Before any curl or skill invocation:

```bash
eval "$(node scripts/nsf-auth.mjs --env)"
curl -sS -b "$NSF_COOKIE_JAR" ${NSF_BASIC:+-u "$NSF_BASIC"} \
  "$NSF_API_BASE_URL/api/auth/me"
```

`--env` reads `~/.nsf/credentials`, materialises a Netscape-format
cookie jar in `$TMPDIR`, and prints `export NSF_API_BASE_URL=…`
+ `export NSF_COOKIE_JAR=…` (+ `export NSF_BASIC=…` when the
session was minted against a basic-auth-gated backend). Exits
non-zero if credentials are missing or expired.

### Threat model

- The web `/cli-auth` route whitelists `return_to` to loopback
  hostnames only (`127.0.0.1`, `localhost`, `[::1]`), so this
  page can't be turned into a JWT-exfiltration redirector.
- A random 128-bit `state` is round-tripped to defeat CSRF on
  the loopback callback.
- Clerk session JWTs are short-lived (default ~1 minute); even
  if the URL leaks into browser history, the token is expired
  before it could be replayed. The downstream `nsf_session`
  cookie never crosses this page.
- `~/.nsf/credentials` is written `chmod 600`; same for the
  cookie jar emitted by `--env`.

## Other scripts in this directory

- `gen-matrix.mjs` — regenerates the per-endpoint capability
  matrix from `apps/api/src/routes/*` `meta` blocks.
- `check-i18n.mjs` — verifies every i18n key in `en` exists in
  every other locale.
- `capture-screenshots.mjs` — Playwright captures for MVP-level
  PR bodies.
- `deploy-l4-example.sh` — one-shot reference for cutting an L4
  drain Worker; not run by CI.
