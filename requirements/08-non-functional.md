[← §7 Media](./07-media.md) · [Index](./README.md) · [§9 Compliance →](./09-compliance.md)

---

## 8. Non-functional requirements

Security and audit fundamentals live in §9. This section covers
everything else: i18n, low-bandwidth / rural, session and OTP,
observability, reliability, accessibility, and browser support.

### 8.1 Internationalisation (i18n)

- **Default set at launch**: `en`, `kn` (Kannada), `ta` (Tamil).
  Subject to §9.6 confirmation.
- **Candidate additions** from the vendor app, gated on actual
  field use: `hi`, `ml` (Malayalam), `te` (Telugu).
- **Language source of truth**: JSON resource bundles shipped with
  the SPA (`/locales/{lang}/common.json`, one per feature area).
  No runtime language editor — changes ship via deploy.
- **Persistence**: user's chosen language is stored in `session`
  (IndexedDB §6.2) and echoed on the server as
  `user.preferred_language` for OTP / notice delivery.
- **String externalisation rule**: no user-facing string ever
  lives in component code. Enforced by a lint rule
  (`eslint-plugin-i18next/no-literal-string`) and a CI grep for
  literal strings in JSX/TSX.
- **Number / date / currency**: `Intl.*` only; no hand-rolled
  formatters.
- **Font coverage**: one variable font that covers Latin +
  Devanagari + Kannada + Tamil + Telugu + Malayalam glyphs
  (e.g. Noto Sans composite) to keep SPA bundle < one font asset.
- **Right-to-left**: not needed (no RTL languages in scope).

### 8.2 Low-bandwidth & rural

Aggressive budgets because field users are on 2G/3G edges.

| Budget | Target | Enforced by |
|---|---|---|
| JS (first load) | ≤ 180 KiB gzipped | CI bundle-size check (`size-limit`) |
| CSS (first load) | ≤ 20 KiB gzipped | same |
| HTML shell | ≤ 8 KiB gzipped | same |
| Font subset (first load) | one WOFF2 ≤ 80 KiB | CI |
| JSON payload (list endpoints, typical) | ≤ 64 KiB gzipped | Load test |
| Image in list view | ≤ 12 KiB (thumbnail) | §7.4 |
| Video in list view | poster only; no autoplay | §7.4 |

Techniques:

- **Compression**: Cloudflare brotli/gzip on all text responses.
- **HTTP/3 QUIC** at the edge (default on Cloudflare) reduces
  handshake cost on flaky links.
- **Request deduplication**: client shares a single in-flight
  promise per URL within a session.
- **Stale-while-revalidate** caching for manifest (§6.9) and
  thumbnails (§7.5).
- **Chunked UI hydration**: route-level code splitting; only the
  current workflow's bundle loads.
- **Retry with jitter** for all network calls (exponential,
  full-jitter, cap 30 s).
- **Optimistic UI** where safe: children add (§3.2.2) renders
  immediately and rolls back on server error.
- **Battery**: Service Worker periodic sync capped at 15-minute
  intervals (§6.5); no always-on background work.

Offline data plane: see §6 in full. Online-reads fall through to
the same IndexedDB cache so the UI is identical regardless of
connectivity.

### 8.3 Password policy

Minimum at launch:

- Length ≥ 8 characters.
- At least one uppercase, one digit, one symbol (`!@#$%^&*_-`).
- Not equal to `TEST*1234` (the vendor default) — forced change
  flow (§3.1.2) rejects re-entry.
- Not equal to one of the last 5 passwords (hashes stored in a
  small `user_password_history` side table, capped at 5 rows per
  user).
- Not present in a bundled top-10 000 common-password list
  (shipped as a Bloom filter in the Worker; < 16 KiB).

Hashing: **Argon2id**, parameters `t=2, m=19456 KiB, p=1`. Tuned
for Worker CPU-time limits; benchmarked at < 50 ms per hash.

Throttling: 3 failed logins lock the account (§3.1.1). Independent
IP-level throttle in KV (10 failed logins / 5 min / IP) protects
against user enumeration.

### 8.4 Session & token TTLs

| Token | Store | Default TTL | Tuned via |
|---|---|---|---|
| Session token (`/auth/login`) | KV namespace `sessions` | 720 min (12 h) | `SESSION_TTL_MINUTES` env var |
| OTP code | KV namespace `otp` | 10 min | `OTP_TTL_MINUTES` env var |
| `password_reset_token` (§5.2) | KV namespace `otp` | 5 min | constant |
| Presigned R2 URL (original) | R2 | 15 min | constant |
| Presigned R2 URL (thumbnail) | R2 | 60 min | constant |
| Idempotency replay | KV namespace `idem` | 24 h | constant |

Cookie attributes for session token:
`HttpOnly; Secure; SameSite=Lax; Path=/; Domain=navsahyog.org`.
On logout, the cookie is cleared and the KV entry deleted.
On password change, all session KV entries for that user are
bulk-deleted.

### 8.5 Rate limits

Enforced in Workers via Cloudflare Rate Limiting rules (or KV
counters where fine-grained).

| Surface | Limit | Scope |
|---|---|---|
| `/auth/login` | 10 / min | per IP |
| `/auth/login` (failure) | 10 / 5 min | per user_id |
| `/auth/otp/request` | `OTP_MAX_PER_HOUR` env var (default 3) | per user |
| `/auth/password-reset` | 5 / hour | per user |
| `/api/sync/outbox` | 60 / min | per session |
| `/api/media/presign` | 120 / min | per session |
| `/api/dashboard/*` | 30 / min | per session |
| Every other `/api/*` | 300 / min | per session |

A 429 response includes `Retry-After` and a JSON body
(`error.code = "rate_limited"`).

### 8.6 Audit trail (operational extension of §9.4)

§9.4 defines the `audit_log` schema and retention. For day-to-day
operations:

- Audit entries are written **synchronously** in the same
  transaction as the action they describe. A transaction that
  fails to write audit rolls the whole thing back.
- Audit writes for bulk actions (retention sweep, migration
  import) batch one entry per batch rather than one per row, with
  `metadata_json.count`.
- A nightly job checks `audit_log` for gaps in `id` sequences and
  alerts the Super Admin on Slack if any are found (tamper
  detection signal, not a guarantee).

### 8.7 Soft delete scope

Soft delete (`deleted_at` + `deleted_by`, §4.1) applies to:

- `user`, `student`, `school`, `village`, `cluster`, `district`,
  `region`, `state`, `zone`.
- `event`, `qualification`, `achievement`,
  `attendance_session`, `notice`, `reference_link`, `quick_link`.
- `media` (row soft-deleted on user action — see §7.7; R2 object lifecycle is out-of-system).

Never soft-deleted (hard delete only):

- `attendance_mark` — replaced in-place per session (§4.3.5).
- `audit_log` — append-only; never modified.

Soft-deleted rows are excluded from every list endpoint by
default. A Super Admin tool (`GET /api/audit-log?action=delete…`)
can reverse a delete within 30 days by clearing `deleted_at`.

### 8.8 Observability

**Logs**:
- Workers Logpush to R2, partitioned daily. One bucket:
  `logs-prod`. Retention: 90 days (lifecycle rule on the bucket).
- No PII in log bodies. Authenticated requests log the user UUID
  and role; request bodies are logged only for 4xx/5xx responses,
  and only after PII fields (Aadhaar, phone, student name) are
  redacted by a Workers middleware.

**Metrics**:
- Workers Analytics Engine events, one dataset per feature
  (`attendance_submit`, `media_commit`, `sync_drain`, …). Fields:
  user UUID (hashed), cluster UUID, latency, status, payload size.
- Dashboards built in Grafana Cloud (free tier) consuming the
  Analytics Engine SQL API. No third-party RUM or analytics SDK
  in the client.

**Traces**:
- W3C `traceparent` generated at the edge and propagated through
  Workers → D1 → Queues. Sampled at 10 % by default; 100 % for
  requests whose session has `debug_trace = 1` (Super Admin
  toggle).

**Alerts** (Cloudflare Notifications → email + Slack):
- 5xx rate > 1 % over 5 min.
- D1 query error rate > 0.5 % over 15 min.
- Outbox drain failure rate > 10 % over 1 hour (from client
  `sync.report`, §6.11).

### 8.9 Reliability & backup

- **D1**: daily automatic backup retained for 30 days. A weekly
  Worker also exports to R2 as `backups/d1/{yyyy-mm-dd}.sql.gz`
  with 1-year retention (Super Admin restore path; tested
  quarterly — see §10 dry-run).
- **R2**: media bucket has versioning disabled (cost). Deletion is
  an out-of-system ops action (§7.7); ops logs the delete manifest
  externally so recovery within R2's lifecycle-tombstone grace
  window stays possible.
- **KV**: session / OTP / idempotency are ephemeral; no backup
  needed.
- **RTO / RPO targets**: RTO 4 h, RPO 24 h. Higher frequencies
  are deferred until usage justifies cost.

### 8.10 Accessibility

- **WCAG 2.1 AA** for all authenticated screens.
- Minimum tap target 44×44 px.
- Contrast ratio ≥ 4.5:1 for text.
- All interactive controls reachable by keyboard and by screen
  reader (axe-core test in CI).
- Voice-note recording has a visible and keyboard-accessible
  stop button (the vendor app relies solely on tap).

### 8.11 Browser & device support

- Android Chrome and Android WebView from the last 3 stable
  versions (rolling).
- Desktop Chrome, Edge, Firefox, Safari — last 2 stable versions
  (for admin roles).
- iOS Safari is **best-effort** at launch (§1.3 non-goal); Part 5
  revisits once field usage data is in.
- Minimum device: 2 GB RAM Android 9; tested on the "field
  baseline" device list (to be enumerated in Part 5).

### 8.12 Versioning & compatibility

- API paths include no version segment at launch; breaking
  changes ship under a new path prefix (`/api/v2/…`) with a
  deprecation window ≥ 90 days. Non-breaking changes are the
  norm (additive JSON fields).
- The SPA and Workers are deployed together; the SPA sends its
  build hash in `X-Client-Build`. Workers reject incompatible
  builds (compat table in code) with a `409 client_outdated` that
  forces a refresh.
- D1 migrations are forward-only, checked in as numbered SQL
  files, run automatically on deploy.

### 8.13 SLOs

| Metric | Target |
|---|---|
| API availability (excluding D1 upstream) | 99.5 % monthly |
| API p50 latency (read, edge-warm) | ≤ 120 ms |
| API p95 latency (read) | ≤ 400 ms |
| API p95 latency (write) | ≤ 800 ms |
| Media commit to thumbnail-ready (p95) | ≤ 30 s |
| Outbox drain success rate (per day) | ≥ 98 % |

### 8.14 Open items

- [ ] Final language set for launch (mirrors §9.6).
- [ ] Field-baseline device list for §8.11.
- [ ] Confirm Grafana Cloud (or self-host on Workers Analytics
      dashboards) for §8.8.
- [ ] Confirm password-history depth (5) and top-common-password
      list size with stakeholder.
- [ ] Confirm alert channels (Slack channel / email list) and
      on-call rotation.

