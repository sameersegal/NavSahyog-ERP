[← §10 Migration](./10-migration.md) · [Index](./README.md) · [Appendix →](./appendix-status-and-next-steps.md)

---

## 11. Cloudflare mapping

Concrete binding manifest for the entire stack. A developer should
be able to translate §11.2–§11.8 straight into `wrangler.toml`
entries and `pnpm create cloudflare` scaffolding.

### 11.1 Environments

Three environments, each a full stack. Separate Cloudflare account
or separate zones — TBD by org preference; bindings below assume a
single account with per-environment resource names.

| Env | Domain | Purpose |
|---|---|---|
| `dev` | `dev.navsahyog.org` | Per-developer ephemeral; bound to non-prod resources; no R2 media parity. |
| `staging` | `staging.navsahyog.org` | Full stack, continuously deployed from `main`; used for P1–P6 migration dry-runs. |
| `production` | `navsahyog.org`, `app.navsahyog.org`, `api.navsahyog.org` | Canonical. Deploys are gated on a green staging run. |

### 11.2 Pages (frontend)

- **Project name**: `navsahyog-app`
- **Framework**: React + Vite. TypeScript. No Next.js — the app is
  a pure SPA and Next adds SSR machinery we don't need.
- **Build**: `pnpm install --frozen-lockfile && pnpm build`.
- **Output**: `dist/`.
- **Routes**:
  - `app.navsahyog.org/*` (prod) — SPA. A custom domain with
    Cloudflare for Cloudflare Pages handles it.
  - `/` returns the shell; every other path is a client-side route.
- **PWA**: Workbox-generated Service Worker; `manifest.webmanifest`
  with icons from 48px to 512px. Install prompt guarded behind
  first-login success.
- **Headers** (`_headers`): `Strict-Transport-Security`,
  `Content-Security-Policy` (no third-party origins except
  Cloudflare Images and R2 signed hostnames), `X-Frame-Options:
  DENY`, `Referrer-Policy: same-origin`.
- **Redirects** (`_redirects`): legacy paths from the vendor app
  (e.g. `/#/home`) to their bespoke equivalents; the vendor's
  legacy URLs are a finite list and well-known.

### 11.3 Workers

Three Worker services (the `retention-sweep` Worker from earlier
drafts is removed per decisions.md D4 — retention is
out-of-system):

1. **`api`** — the main REST API.
   - Routes:
     - `api.navsahyog.org/*` (prod)
     - `api.staging.navsahyog.org/*`, `api.dev.navsahyog.org/*`
   - Bindings: D1 (`DB`), all KV namespaces, R2 buckets, Queues
     producers, Analytics Engine, service bindings to the
     `migrator` worker (gated).
   - Entrypoints: `fetch`, `queue` consumer.
2. **`derive-media`** — Queues consumer for §7.4 (thumbnails,
   posters).
   - Bindings: R2 (`MEDIA`, `MEDIA_DERIVED`), Cloudflare Images,
     D1 (`DB`) for status writes.
3. **`migrator`** — The §10.3 migration runner. Private to
   Super Admin via Cloudflare Access.

Each Worker is its own `wrangler.toml` project under `/workers/`.

### 11.4 D1

- **Database name**: `navsahyog-prod` / `navsahyog-staging` /
  `navsahyog-dev`.
- **Binding**: `DB` (in `api`, `derive-media`, `migrator`).
- **Migrations**: SQL files in `/workers/api/migrations/`, applied
  on every deploy by `wrangler d1 migrations apply` in CI.
- **Schema source of truth**: §4. Full DDL checked in as
  `/workers/api/schema.sql` on Part 5b merge.
- **Backups**: automatic daily + the §8.9 weekly R2 export.

### 11.5 R2

Buckets per §7.1, plus three operational buckets:

| Binding | Bucket | Purpose |
|---|---|---|
| `MEDIA` | `media-prod` / `media-staging` | Field-captured media. |
| `MEDIA_DERIVED` | `media-derived-prod` / `...staging` | Thumbnails and video posters. Kept separate so ops can lifecycle originals and derivatives independently on the bucket. |
| `BACKUPS` | `backups-prod` | Weekly D1 snapshots (§8.9). 1-year lifecycle. |
| `LOGS` | `logs-prod` | Workers Logpush destination (§8.8). 90-day lifecycle. |
| `ARCHIVE` | `archive-vendor` | Post-decommission cold copy of the vendor-era corpus (§10.9). 1-year retention. |

### 11.6 KV namespaces

| Binding | Namespace | TTL | Purpose |
|---|---|---|---|
| `SESSIONS` | `sessions-{env}` | 12 h (§8.4) | Session tokens keyed by UUID. |
| `OTP` | `otp-{env}` | 10 min | OTP codes and reset tokens. |
| `IDEM` | `idem-{env}` | 24 h | Idempotency replay cache (§5.1, §6). |
| `RATE` | `rate-{env}` | 5 min | Fine-grained counters for §8.5 (beyond what Cloudflare's own Rate Limiting rules cover). |
| `FLAGS` | `flags-{env}` | ∞ | Runtime flags (e.g. `feature.vendor_fallback` from §10.9). Writes audited. |

### 11.7 Queues

| Queue | Producer | Consumer | Purpose |
|---|---|---|---|
| `media-derive` | `api` | `derive-media` | §7.4 renditions. |
| `migration-media` | `migrator` | `migrator` | §10.6 media backfill. |
| `sync-dlq` | `api` | manual / alert only | Dead-letter for `/api/sync/outbox` items that exhausted server-side retries. Super Admin drains. |

All queues are set to `max_retries = 3` with a 30 s visibility
timeout unless noted otherwise. DLQ on each.

### 11.8 Durable Objects

Optional for launch; use only if §8.13 consolidated-dashboard
latency targets are not met with pure D1.

- **`ClusterCounters`** (class in `api`) — one DO instance per
  cluster UUID, holding live counters for attendance %, image %,
  video %, SoM counts. Incremented in-line on write endpoints;
  flushed to D1 hourly as a cache rebuild safety net.

Start without DOs; add in a follow-up if needed. Flagged in §11.11.

### 11.9 Secrets

Stored via `wrangler secret put`. Every secret has a rotation
owner and an alert on age > 180 days (§8.8).

| Secret | Surface | Owner |
|---|---|---|
| `GOOGLE_MAPS_KEY` | `api`, Pages build | Ops. **Rotate before first public release** (§9.5). |
| `OTP_SMS_PROVIDER_KEY` | `api` (for `/auth/otp/request`) | Ops. TBD provider (MSG91 / Twilio / Kaleyra). |
| `OTP_EMAIL_SMTP_URL` | `api` | Ops. Suggested: Amazon SES or Mailgun. |
| `ARGON2_PEPPER` | `api` | Security lead. Global pepper added alongside per-user salt. |
| `ADMIN_JUMP_ACCESS_TOKEN` | `migrator` | Super Admin. Cloudflare Access application token. |
| `VENDOR_ADMIN_COOKIE` | `migrator` (P2 fallback) | Super Admin. Only needed if §10.1 path 2 is used. |
| `CF_IMAGES_ACCOUNT_HASH` | `derive-media` | Ops. |
| `GRAFANA_CLOUD_PUSH_URL` | `api` | Ops. |

### 11.10 CI / CD

- GitHub Actions. Repo layout:
  - `/apps/web` — Pages SPA.
  - `/workers/api` · `/workers/derive-media` · `/workers/migrator`.
  - `/packages/shared` — shared TypeScript types (auto-generated
    from D1 schema via `drizzle-kit`; not runtime-coupled).
  - `/tools/migrator/checks` — §10.7 SQL checks.
- **PR pipeline**: lint, typecheck, unit tests, `size-limit`
  (§8.2 budgets), SQL migrations dry-run against a sandbox D1
  copy.
- **Staging deploy**: on `main` merge. Runs smoke tests against
  `staging.navsahyog.org`; block alerting on regressions.
- **Production deploy**: manual `workflow_dispatch` after a green
  staging run, with a required approver. D1 migrations applied
  first, then Workers, then Pages (ensures the SPA lands on a
  schema-compatible API).
- **Rollback**: `wrangler rollback` per Worker; Pages has
  instant rollback to a prior deployment. D1 migrations are
  forward-only (§8.12); rollback of a bad migration requires a
  new forward migration.

### 11.11 Cost envelope (order-of-magnitude at launch)

Assuming 3 000 users, 1 000 active villages, 30 GB new media per
month, Cloudflare published pricing as of the time of writing:

| Line | Monthly |
|---|---|
| Workers paid plan (required for D1 + R2 bindings in prod) | $5 |
| Workers requests (~15 M/mo) | ~$4 |
| D1 rows read / written (within free paid-plan allowance) | $0 |
| R2 storage (~30 GB/mo growth × 18 months retention = ~540 GB steady) | ~$8 |
| R2 Class A / B operations | ~$2 |
| Cloudflare Images transformations (if used) | ~$5 |
| KV reads / writes | ~$1 |
| Queues messages | ~$1 |
| Logpush to R2 | ~$1 |
| **Estimated total** | **~$25–30 / month** |

An order of magnitude below a typical SaaS NGO-platform bill. The
tech-stack choice in §1.4 holds.

### 11.12 Consolidated open items

Every `[ ]` item from earlier sections in one place, so a
stakeholder review meeting can work through them in sequence.

From §9.6 (compliance & product):
- [ ] Which languages are actually used in the field?
- [ ] Are `Territory` and `Taluk` geo levels populated?
- [ ] Audit-log retention period.
- [ ] iOS required at launch, or Android + PWA only?
- [ ] Play Store APK distribution vs PWA install only.
- [ ] AF ↔ Cluster cardinality (1:1 or many:many).

From §4.5 (data model):
- [ ] `Territory` / `Taluk` drop confirmation (migration dry-run).
- [ ] `MembershipType` drop confirmation.
- [ ] `school.type` CHECK enum vs lookup table.
- [ ] Aadhaar masking policy: last-4-only vs encrypted-at-rest.

From §5.17 (API surface):
- [ ] Route prefix `/api/` vs `/v1/`.
- [ ] `/sync/manifest` single vs per-resource.
- [ ] District+ write access: read-only confirmed?

From §6.13 (offline):
- [ ] Offline student creation permitted?
- [ ] Manifest granularity (mirrors §5.17).
- [ ] Device-bound outbox key acceptable?

From §7.9 (media):
- [ ] Null-GPS uploads permitted?
- [ ] Cloudflare Images vs in-Worker `wasm-vips`.
- [ ] Video max length.
- [ ] Retention default (180 days?).

From §8.14 (non-functional):
- [ ] Final language set (mirrors §9.6).
- [ ] Field-baseline device list.
- [ ] Grafana Cloud vs alternative dashboard host.
- [ ] Password-history depth + common-password list size.
- [ ] Alert channels and on-call rotation.

From §10.11 (migration):
- [ ] Vendor DB dump access.
- [ ] Password-migration policy (preserve vs force reset).
- [ ] Dual-run window (30 / 60 / 90 days).
- [ ] Broadcast channels for cut-over.
- [ ] Final go/no-go criteria.

From §11 (this section):
- [ ] Durable Objects at launch? Deferred by default (§11.8).
- [ ] OTP provider choice (MSG91 / Twilio / Kaleyra / other).
- [ ] Email provider choice (SES / Mailgun / other).

