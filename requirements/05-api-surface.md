[← §4 Data model](./04-data-model.md) · [Index](./README.md) · [§6 Offline & sync →](./06-offline-and-sync.md)

---

## 5. API surface

Workers expose a **REST-over-JSON** API under `/api/*` and
`/auth/*`. The vendor's 286 Struts operations collapse to **~30
routes**. This is a bespoke-only simplification; we do not need the
`Check*`, `SystemUpdate*`, `getSingle*` family because REST verbs
already cover existence, bulk reactivate, and single-resource
fetches.

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
  and replays the prior response on retry. Required for offline
  outbox (§6).
- **Content type**: `application/json` only. Media uploads use
  presigned R2 URLs (§5.8), not multipart through the Worker.

### 5.2 Authentication — `/auth/*`

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | Body `{ user_id, password }`. Returns session token + user profile. Increments `failed_login_count` on failure; locks account at 3. |
| `POST` | `/auth/change-password` | Authenticated. Body `{ old_password, new_password }`. Rejects re-entering `TEST*1234` (§3.1.2). Clears all other sessions. |
| `POST` | `/auth/otp/request` | Body `{ user_id, channel: 'email' \| 'sms' }`. Rate-limited per `OTP_MAX_PER_HOUR` Worker env var. |
| `POST` | `/auth/otp/verify` | Body `{ user_id, code }`. Returns a short-lived `password_reset_token`. |
| `POST` | `/auth/password-reset` | Body `{ password_reset_token, new_password }`. Unlocks and clears all sessions. |
| `POST` | `/auth/logout` | Deletes the KV session. |
| `GET`  | `/auth/me` | Returns the current user profile. |

### 5.3 Geography — `/api/geo/*`

All GETs are scope-filtered. POST/PATCH/DELETE require
`cluster_admin` or higher, each scoped to their own level or
below.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/geo/zones` | List. |
| `GET` | `/api/geo/states?zone=<uuid>` | List within scope. |
| `GET` | `/api/geo/regions?state=<uuid>` | |
| `GET` | `/api/geo/districts?region=<uuid>` | |
| `GET` | `/api/geo/clusters?district=<uuid>` | |
| `GET` | `/api/geo/villages?cluster=<uuid>&q=<string>` | Both params optional; caller must narrow within their scope. `cluster` filters to one cluster; `q` is a case-insensitive substring match on village name (supports the donor-update workflow, §3.9). Response includes coordinates, pincode, program window. |
| `POST` / `PATCH` / `DELETE` | `/api/geo/{level}/…` | Same shape for each level (`zones`, `states`, `regions`, `districts`, `clusters`, `villages`). Soft delete only. |
| `POST` | `/api/geo/villages/:uuid/set-coordinates` | Replaces the vendor's `UpdateVillageCoordinates`. Body `{ latitude, longitude, altitude?, radius_m? }`. |

### 5.4 Users & roles — `/api/users`

Requires `cluster_admin` or higher (Super Admin for role changes).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/users?role=&scope_level=&scope_id=&q=` | Scope-filtered. |
| `POST` | `/api/users` | Create user. Auto-generates `user_id` or accepts one. Sets default password. |
| `GET` | `/api/users/:uuid` | |
| `PATCH` | `/api/users/:uuid` | Update profile fields. Role / scope changes are Super-Admin-only and emit `audit_log.user.role_change`. |
| `POST` | `/api/users/:uuid/unlock` | Resets `failed_login_count` and `locked_at`. |
| `POST` | `/api/users/:uuid/reset-password` | Sets `password_is_default = 1` and a fresh default. |
| `DELETE` | `/api/users/:uuid` | Soft delete + sets `left_at`. |

### 5.5 Schools — `/api/schools`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/schools?village=<uuid>` | |
| `POST` / `PATCH` / `DELETE` | `/api/schools[/:uuid]` | Standard CRUD, soft delete. |

### 5.6 Students — `/api/children`

Uses the vendor's user-facing term "children" in the URL for
clarity; the table is still `student` (§4.3.3).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/children?village=<uuid>&include_graduated=false&q=` | Scope-filtered. Default excludes graduated. |
| `POST` | `/api/children` | Create. Server rejects any `aadhaar` field (§9.1). |
| `GET` | `/api/children/:uuid` | |
| `PATCH` | `/api/children/:uuid` | Update profile / parent fields. |
| `POST` | `/api/children/:uuid/graduate` | Body `{ date, reason }`. Sets `graduated_at` and removes from active lists. |
| `DELETE` | `/api/children/:uuid` | Soft delete (rare; graduation is the normal path). |

### 5.7 Events, activities, qualifications — `/api/events`, `/api/activities`, `/api/qualifications`

Events and activities share the `event` table (§4.3.4) but are
surfaced as two endpoints for UI clarity.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/events` | `event.kind = 'event'`. |
| `GET` | `/api/activities` | `event.kind = 'activity'`. |
| `POST` / `PATCH` / `DELETE` | `/api/events[/:uuid]` | Admin. |
| `POST` / `PATCH` / `DELETE` | `/api/activities[/:uuid]` | Admin. |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/qualifications[/:uuid]` | |

### 5.7.1 Training manuals — `/api/training-manuals`

Read-only catalogue surfaced at `/training-manuals` (§3.8.8).
Reads gated on `training_manual.read` (every authenticated role);
writes gated on `training_manual.write` (Super Admin only).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/training-manuals` | Returns `{ manuals: [{ id, category, name, link, updated_at }] }`, sorted by `category` then `name` (NOCASE). |
| `POST` | `/api/training-manuals` | Body `{ category, name, link }`. `link` must be `http(s)`; non-URL or other-scheme inputs return 400. Duplicate `(category, name)` returns 409. Server stamps `created_at = updated_at = now`. |
| `PATCH` | `/api/training-manuals/:id` | Partial update of the same fields. Same validation; `updated_at` is bumped to the current epoch second on every PATCH. |

### 5.8 Media — `/api/media/*`

Two-step upload: **presign → direct PUT to R2 → commit metadata**.
The Worker never proxies media bytes.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/media/presign` | Body `{ kind, mime, bytes }`. Returns `{ uuid, r2_key, upload_url, expires_at }`. Expiry ≤ 15 min. |
| `POST` | `/api/media` | Commit after successful PUT. Body `{ uuid, kind, r2_key, mime, bytes, captured_at, latitude, longitude, village_id, tag_event_id }`. |
| `GET` | `/api/media?village=<uuid>&kind=&from=&to=` | List + R2 presigned GET URLs (short TTL). |
| `GET` | `/api/media/:uuid` | Single, with fresh presigned GET URL. |
| `DELETE` | `/api/media/:uuid` | Soft delete in DB; actual R2 object deleted by retention cron (§9.3). |

The vendor's `UploadSingleImage` / `UploadSingleVideo` /
`fileuploadInfo` collapse into this pair. Large videos use multipart
(the presign endpoint returns a multipart init token when
`bytes > 10 MiB`).

### 5.9 Attendance — `/api/attendance`

Session-oriented: one POST writes the session and all marks
transactionally.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/attendance` | Body `{ village, date, event, start_time, end_time, voice_note_media?, marks: [{ student, present }] }`. Upserts on `(village, date, event)` and replaces marks. Returns the session with canonical IDs. |
| `GET` | `/api/attendance?village=&from=&to=` | List sessions + marks. Supports cluster-level scope. |
| `GET` | `/api/attendance/:uuid` | Single session with marks. |
| `DELETE` | `/api/attendance/:uuid` | Soft delete (Super Admin only). |

### 5.10 Achievements — `/api/achievements`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/achievements?village=&from=&to=&type=` | |
| `POST` | `/api/achievements` | Body `{ student, description, date, type, gold_count?, silver_count? }`. Validates type/medal invariants. Enforces "one SoM per student per month" (§4.3.6). |
| `GET` / `PATCH` / `DELETE` | `/api/achievements/:uuid` | |

### 5.11 Dashboards — `/api/dashboard/*`

Read-only, scope-filtered. Export generation runs in the Worker and
streams a `text/csv` response (decisions.md D2 — CSV replaces XLSX).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/dashboard/drilldown?metric=&level=&id=` | Metric ∈ `vc`, `af`, `children`, `attendance`, `achievements`. Returns rows for the next level below `(level, id)`. |
| `GET` | `/api/dashboard/drilldown.csv?…` | Same filters; CSV download. |
| `GET` | `/api/dashboard/consolidated?cluster=&date=` | Single-day view. |
| `GET` | `/api/dashboard/consolidated?cluster=&from=&to=` | Range view. |
| `GET` | `/api/dashboard/consolidated.csv?…` | CSV. |

Replaces the vendor's `getAttendanceStatusby{Level}`,
`ListDatewise…`, `ListRangewise…`, `ListClusterWiseStarOfMonth`,
`ClusterWiseStarOfPreviousMonth`, etc.

### 5.12 Content

**Cancelled — decisions.md D15.** `/api/notices`,
`/api/reference-links`, `/api/quick-links`, and `/api/about` are
removed together with §3.8.2–§3.8.5 and the underlying tables
(§4.3.8). Section number retained for stable cross-references.

### 5.13 Settings

No `/api/settings` endpoint. Runtime tunables live in Worker env
vars; retention is out-of-system. Section number retained for
stable cross-references.

### 5.14 Sync / outbox — `/api/sync/*`

Supports the offline outbox (§6). Full semantics in Part 4.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/sync/outbox` | Body `{ items: [{ idempotency_key, method, path, body }] }`. Applies each item in order, returning per-item results. Each item is equivalent to calling its `method path body` directly. |
| `GET` | `/api/sync/manifest?since=<epoch>` | Returns the list of records the client should pull for its scope since the given time (used by "Download Server Data"). |

### 5.15 Audit log — `/api/audit-log`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/audit-log?actor=&action=&from=&to=` | Super Admin only. |

### 5.18 Jal Vriddhi ponds — `/api/ponds/*`

Routes for §3.10. Numbered out of source-order so §5.16 / §5.17
keep their existing cross-references. All gated by `pond.read`
(reads) or `pond.write` (writes); scope-bound through
`assertVillageInScope` against `farmer.village_id` or, for the
upload endpoints, the village_id signed into the HMAC token.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/ponds?village_id=` | Scope-filtered list of ponds; each row carries the farmer + the latest agreement version inline. |
| `GET` | `/api/ponds/:id` | Pond detail with the full agreement history (versions descending). |
| `POST` | `/api/ponds` | Create farmer + pond + version 1 in one call. Agreement bytes must already be in R2 via `/agreements/presign` + PUT. |
| `POST` | `/api/ponds/:id/agreements` | Append a new agreement version (`MAX(version) + 1`). Append-only — re-uploads never overwrite. |
| `POST` | `/api/ponds/agreements/presign` | HMAC presign for an agreement upload. Bound to `village_id`, not `pond_id`, so the same presign serves both create + re-upload. |
| `PUT` | `/api/ponds/agreements/upload/:uuid?token=` | Token-gated R2 receiver. No session cookie. Mirrors `/api/media/upload/:uuid`. |
| `GET` | `/api/ponds/agreements/raw/:uuid` | Authenticated read-through to the R2 object. Scope-checked against the owning pond. |

Allowed agreement MIMEs: `application/pdf`, `image/jpeg`,
`image/png`. App-level cap: 25 MiB raw. Token version marker is
`agreement-v1`, distinct from media's `v1` so a media-presign
token can't be replayed against an agreement endpoint.

### 5.19 Public program APIs — `/api/programs/*`

Backs the program apps embedded on the NavSahyog public website
(§1.5). Numbered after §5.18 to keep existing cross-references
stable. Currently exposes **one** route — Jal Vriddhi (§3.10) —
with each new program added as a sibling.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/programs/jal-vriddhi` | Aggregate stats + per-pond markers for the Jal Vriddhi infographic. |

**Contract.** Every route under `/api/programs/*` MUST satisfy
all six rules below. The contract is global, not per-route, so a
new program endpoint cannot weaken any of them:

1. **No auth.** No session cookie, no `Authorization` header, no
   API key. The Worker rejects credentials if presented (drops
   the cookie before lookup) so a session left over from a
   logged-in NavSahyog user (e.g. a VC who happens to land on the
   embedder page) cannot accidentally elevate the response.
2. **GET only.** No POST/PATCH/DELETE. The CORS layer also
   refuses `Access-Control-Allow-Methods` beyond `GET, OPTIONS`,
   so a misconfigured route can't accidentally write.
3. **PII allowlist on the response builder.** Each route declares
   the exact field set it returns, populated from a typed mapper
   (not a `SELECT *` passthrough). The full deny-list lives in
   §9.5; the field-level rule is "if a column carries a name, a
   number, an address, a free-text note, or an internal id, it
   does not appear in the response, period". A test in
   `apps/api/test/programs.test.ts` enforces this against the
   wire bytes (regex on JSON.stringify) so a future passthrough
   regression fails CI.
4. **Coordinate coarsening.** GPS columns served publicly are
   rounded to **3 decimal places** (~110 m) at the response
   builder. The full-precision value stays in D1 for the
   authenticated app.
5. **Permissive CORS, scoped.** `Access-Control-Allow-Origin: *`
   with `credentials: false` for `/api/programs/*` only. The rest
   of the API keeps its credentialed allowlist (§5.1). For
   production we tighten this to an env-driven allowlist of known
   embedder origins (`navsahyog.org` + partner sites) — browser-
   only protection, but enough to discourage casual third-party
   embedding that would consume our bandwidth.
6. **Edge rate-limit.** Cloudflare Rate Limiting on
   `/api/programs/*` capped at **60 req/min/IP** (tunable per
   environment). Bot floor without API keys; protects D1 from a
   single IP draining the budget.

**Performance isolation.** Public traffic must not degrade the
authenticated app. The contract above (rate limit + CORS lock)
plus the lean response shape gets us to a workable floor; if
demand grows past it, the upgrade path is **edge-cache the JSON
response** via the Cloudflare Cache API with a 60 s TTL (the data
changes in days/weeks; up to a minute of staleness is acceptable
for an infographic). Deferred — only land it once we see real
traffic. A cache-purge step in the pond create / update path
keeps freshness if/when we adopt it.

**Staging gate.** Public program APIs are carved out of the
staging basic-auth gate (§7 / Cloudflare deploy). They have to be
reachable from any browser regardless of staging credentials.

### 5.16 Summary

Route count: **≈ 30** top-level paths (many supporting multiple
verbs). The vendor's 286 `operation:` codes collapse into these
because:

- `Insert* / Update* / Delete* / ListAll* / getSingle*` per entity
  → one REST collection + item per entity (×5 verbs folded into 3
  URLs).
- `Check*` (FK existence) → dropped. Clients use `GET /:uuid` and
  check 404; writes get a 409 on FK violation.
- `SystemUpdate*` (bulk reactivate) → dropped from the external
  API. Implemented as a Worker maintenance script when needed.
- `UploadSingleImage` / `UploadSingleVideo` / `fileuploadInfo` →
  `/api/media/presign` + `/api/media`.
- `getAttendanceStatusby*` / `ListDatewise…` / `ListRangewise…` /
  `ListClusterWiseStarOfMonth` / `ClusterWiseStarOfPreviousMonth`
  → `/api/dashboard/*` with query parameters.
- Struts `.do` endpoints (`mlogin`, `accountSetup`, …) → `/auth/*`.

### 5.17 Open items

- [ ] Confirm route prefix (`/api/` vs `/v1/`). Part 5 may pin this
      when Cloudflare Pages + Workers routing is nailed down.
- [ ] Decide whether to expose `/api/sync/manifest` as a single
      endpoint or per-resource (`/api/children?since=`, …). Single
      endpoint keeps the client simple; per-resource is easier to
      cache at the edge.
- [ ] Confirm whether District+ admins need any write endpoints at
      all, or if the §2.3 capability matrix (read-only) holds.

