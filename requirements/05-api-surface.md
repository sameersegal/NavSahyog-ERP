[← §4 Data model](./04-data-model.md) · [Index](./README.md) · [§6 Offline & sync →](./06-offline-and-sync.md)

---

## 5. API surface

Workers expose a **REST-over-JSON** API under `/api/*` and
`/auth/*`. The vendor's 286 Struts operations collapse to **~30
routes** by leaning on REST verbs (no `Check*`, `SystemUpdate*`,
`getSingle*` family — existence is `GET /:uuid` + 404, FK
violations are 409, bulk operations are maintenance scripts).

The per-endpoint matrix — method, path, capability, roles,
idempotency, offline mode — lives at
[`generated/endpoints.md`](./generated/endpoints.md), regenerated
from each route file's `meta` block by `pnpm matrix`.
Bounded-context narratives that the matrix can't carry (state
machines, cross-handler invariants, lifecycle gotchas) live under
[`contexts/`](./contexts/).

This section covers what neither code nor the matrix can carry:
the global wire conventions, and the public-program-API contract
that constrains every `/api/programs/*` route.

### 5.1 Conventions

- **Base URL**: `https://api.navsahyog.org/` (prod),
  `https://api.staging.navsahyog.org/` (staging).
- **Auth**: all `/api/*` routes require a session cookie or
  `Authorization: Bearer <token>`. `/auth/*` routes are
  unauthenticated except `/auth/logout` and `/auth/change-password`.
- **Scope enforcement**: every route derives the caller's
  `(role, scope_level, scope_id)` from the session and enforces it
  server-side. Query parameters narrow within scope; they cannot
  broaden it.
- **Resource IDs in URLs use `uuid`**, not rowid. This keeps IDs
  stable across environments and matches the outbox idempotency
  key (§6).
- **Pagination**: cursor-based. `?limit=50&cursor=<opaque>`. Max
  `limit` = 200. Responses include `next_cursor` (null when done).
- **Errors**: JSON `{ "error": { "code": "…", "message": "…",
  "details": … } }`. Standard codes: `unauthenticated`,
  `forbidden`, `not_found`, `conflict`, `validation`,
  `rate_limited`, `internal`.
- **Idempotency**: every POST/PATCH accepts an
  `Idempotency-Key` header; the Worker records it in KV for 24 h
  and replays the prior response on retry. Mandatory for
  `/api/sync/outbox` items, optional but recommended for direct
  POST/PATCH.
- **Content type**: `application/json` only. Media uploads use
  presigned R2 URLs, not multipart through the Worker.

### 5.2 Authentication — `/auth/*`, `/webhooks/clerk`

See `apps/api/src/routes/auth.ts` (login / exchange / logout /
me) and `apps/api/src/routes/webhooks_clerk.ts` (the Svix-signed
provisioning endpoint that creates and updates local user rows in
response to Clerk events). The `generated/endpoints.md` matrix
carries the per-route capability / offline mode. Architecture
overview lives in D36; per-context invariants and lifecycle
gotchas live in [`contexts/identity/`](./contexts/identity/).

### 5.3 Geography — `/api/geo/*`

See `apps/api/src/routes/geo.ts`.

### 5.4 Users & roles — `/api/users`

See `apps/api/src/routes/users.ts` and the masters context at
[`contexts/masters/`](./contexts/masters/).

### 5.5 Schools — `/api/schools`

See `apps/api/src/routes/schools.ts` and
[`contexts/masters/`](./contexts/masters/).

### 5.6 Students — `/api/children`

See `apps/api/src/routes/children.ts` and the beneficiaries context
at [`contexts/beneficiaries/`](./contexts/beneficiaries/). The URL
keeps the user-facing term "children"; the table is `student`
(§4.3).

### 5.7 Events, activities, qualifications

See `apps/api/src/routes/events.ts`, `activities.ts`,
`qualifications.ts`, and [`contexts/masters/`](./contexts/masters/).
Events and activities share the `event` table but are surfaced as
two endpoints for UI clarity.

### 5.7.1 Training manuals — `/api/training-manuals`

Read-only catalogue (§3.8.8). Reads gated on
`training_manual.read` (every authenticated role); writes gated on
`training_manual.write` (Super Admin only). See
`apps/api/src/routes/training-manuals.ts`.

### 5.8 Media — `/api/media/*`

Two-step upload: **presign → direct PUT to R2 → commit metadata**.
The Worker never proxies media bytes. See
`apps/api/src/routes/media.ts`. Multipart presign currently
deferred (D9, L2.4b).

### 5.9 Attendance — `/api/attendance`

Session-oriented: one POST writes the session and all marks
transactionally. Idempotent by `(village, date, event)` —
re-submission replaces the marks list. See
`apps/api/src/routes/attendance.ts` and
[`contexts/beneficiaries/`](./contexts/beneficiaries/).

### 5.10 Achievements — `/api/achievements`

Enforces "one SoM per student per month" via partial unique index
on `achievement` (§4). See `apps/api/src/routes/achievements.ts`.

### 5.11 Dashboards — `/api/dashboard/*`

Read-only, scope-filtered. CSV export streams from the Worker
(D2 — CSV replaces XLSX). See
`apps/api/src/routes/dashboard.ts` and
[`contexts/dashboard/`](./contexts/dashboard/).

### 5.12 Content

**Cancelled — D15.** `/api/notices`, `/api/reference-links`,
`/api/quick-links`, `/api/about` are removed together with
§3.8.2–§3.8.5 and the underlying tables. Section number retained
for stable cross-references.

### 5.13 Settings

No `/api/settings` endpoint. Runtime tunables live in Worker env
vars; retention is out-of-system (D1, D4). Section number retained
for stable cross-references.

### 5.14 Sync / outbox — `/api/sync/*`

Supports the offline outbox (§6). `GET /api/sync/manifest` returns
the **full read-cache snapshot** scoped to the user's authority
(D32 replace-snapshot — supersedes the prior `?since=` delta
protocol). Additive-only contract per D30. See
`apps/api/src/routes/sync.ts`.

### 5.15 Audit log — `/api/audit-log`

Super Admin only. See `apps/api/src/routes/audit-log.ts` (lands
with L5).

### 5.16 Summary

Route count: ~30 top-level paths. The vendor's 286 `operation:`
codes collapse via REST verbs + idempotent upsert + presigned R2.
The current per-route detail is in
[`generated/endpoints.md`](./generated/endpoints.md).

### 5.17 Open items

- [ ] Confirm route prefix (`/api/` vs `/v1/`).
- [ ] Confirm whether District+ admins need any write endpoints at
      all, or if the §2.3 capability matrix (read-only) holds.

Resolved: manifest granularity (D32, single replace-snapshot
endpoint).

### 5.18 Jal Vriddhi ponds — `/api/ponds/*`

See `apps/api/src/routes/ponds.ts` and
[`contexts/programs/`](./contexts/programs/). Append-only agreement
versions per D26; agreement uploads ride a parallel HMAC token
machinery (separate from media) per D27. Allowed agreement MIMEs:
`application/pdf`, `image/jpeg`, `image/png`. App-level cap:
25 MiB raw.

### 5.19 Public program APIs — `/api/programs/*`

Backs the program apps embedded on the NavSahyog public website
(§1.5). Currently exposes one route — Jal Vriddhi (§3.10) — with
each new program added as a sibling.

The contract is **global, not per-route**: a new program endpoint
cannot weaken any of these rules without a D-numbered decision.

1. **No auth.** No session cookie, no `Authorization` header, no
   API key. The Worker drops credentials if presented so a session
   left over from a logged-in user (e.g. a VC who happens to land
   on the embedder page) cannot accidentally elevate the response.
2. **GET only.** CORS refuses `Access-Control-Allow-Methods`
   beyond `GET, OPTIONS`.
3. **PII allowlist on the response builder.** Each route declares
   the exact field set it returns, populated from a typed mapper
   (not a `SELECT *` passthrough). Field-level rule: if a column
   carries a name, number, address, free-text note, or internal
   id, it does not appear. The full deny-list lives in §9.5;
   `apps/api/test/programs.test.ts` enforces it on the wire bytes.
4. **Coordinate coarsening.** GPS columns served publicly are
   rounded to **3 decimal places** (~110 m) at the response
   builder. Full precision stays in D1 for the authenticated app.
5. **Permissive CORS, scoped.** `Access-Control-Allow-Origin: *`
   with `credentials: false` for `/api/programs/*` only. The rest
   of the API keeps its credentialed allowlist. Production
   tightens this to an env-driven allowlist of known embedder
   origins (`navsahyog.org` + partner sites) — tracked as U10.
6. **Edge rate-limit.** Cloudflare Rate Limiting on
   `/api/programs/*` capped at **60 req/min/IP** (tunable per
   environment) — tracked as U9.

**Performance isolation.** If demand grows past the rate-limit
floor, the upgrade path is edge-cache the JSON response via
Cloudflare Cache API with a 60 s TTL. Deferred until real traffic
warrants it.

**Staging gate.** Public program APIs are carved out of the
staging basic-auth gate. They have to be reachable from any
browser regardless of staging credentials.
