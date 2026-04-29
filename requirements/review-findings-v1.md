# Requirements — Review Findings v1

[← Index](./README.md)

**Purpose.** Living list of issues raised against `requirements/`
v1. Resolved items collapse to one-line entries with a back-pointer
to the decision that closed them; open items keep their original
prompt + proposed fix until they land.

**How to use.** Walk Open Blockers → Open High → Open Medium → Open
Low. Each open row has a problem, a location, and a recommended
fix. When one closes, move it to §0 and link the decisions.md row.

---

## Severity legend

- **BLOCKER** — must be resolved before implementation begins.
- **HIGH** — resolve before the relevant section is touched in code.
- **MEDIUM** — should be resolved, but work can progress.
- **LOW** — polish. Fix when convenient.

---

## 0. Resolved

Each row is closed; the spec text reflects the decision and the
durable record lives in `requirements/decisions.md`.

| Item | Closed by | Resolution |
|---|---|---|
| §9 Compliance was mislocated | (this review) | `09-compliance.md` is now the sole home for §9; the duplicate in the appendix file is gone. |
| Vendor name in spec | (this review) | Direct vendor product / URL references replaced with generic "vendor" language; `vmr_settings` renamed to `legacy_settings`. |
| **B1** Graduate offline policy | offline-scope.md §3.2.2 | `PATCH /api/children/:id` and `/graduate` are `online-only`; offline mode disables the Graduate button. |
| **B2** Offline student creation | D35 | `POST /api/children` is `offline-eligible` with a *visibility-after-sync* rule (no optimistic UI in pickers). |
| **B3** District+ admins read-only | policy layer | `apps/api/src/policy.ts` mirrors §2.3 as data; `requireCap(...)` enforces it. District+ roles will only carry `.read` caps. |
| **H2** Sync manifest granularity | D32 | §6.4's delta protocol is replaced by a full-snapshot manifest scoped to the user's authority. |
| **H3** Cross-workflow offline refs | D35 | Visibility-after-sync removes the placeholder-ID rewrite surface entirely — no achievement / attendance row will ever reference a client-only student id. |
| **H5** Event ↔ Activity merge | D23 | `event.kind` immutability enforced server-side by L3.1's PATCH route (`409 event.kind frozen`); admin list returns `kind_locked` for the UI. |
| **U1** Device-level concurrency | §6.12 (lines 317–319) | Outbox is device-local; second device drains independently; server dedupes via `Idempotency-Key`. |
| **U3** Language-switcher conflict | D15 | §3.8.6 cancelled. In-menu toggle writes `localStorage`; `user.preferred_language` is echoed on login for OTP delivery. |
| **U5** Student retention grace | D1 | `app_settings` table dropped. Retention is handled out-of-system. |
| **U6** Idempotency required vs tolerated | §5.1 (line 35) | `Idempotency-Key` is mandatory for `/api/sync/outbox`, optional but recommended for direct POST/PATCH. |

---

## 1. Open BLOCKERS

*None.*

---

## 2. Open HIGH

### H1 — AF ↔ Cluster cardinality blocks the scope model
- §2.1 describes AFs as covering "multiple villages in a cluster."
- §4.3.1 puts `scope_level` + `scope_id` on the user row, implying
  each user anchors to one node.
- §11.12 still lists this as unresolved.
- If AFs can span clusters, the single-anchor model breaks. Impacts
  pickers (§3.2.1, §3.4.3) and every scope check (§5.*).
- **Decision prompt.** Confirm with NavSahyog ops: **1 AF : 1 cluster**
  (recommended — simplest) or **many : many** (requires a
  `user_scope` junction table).
- **Fix path A.** Keep §4.3.1 as-is; add a note: "one AF = one
  cluster."
- **Fix path B.** Replace `scope_id` with `user_scope(user_id,
  scope_level, scope_id)`. Re-audit every scope check.

### H4 — Migration vs. onboarding-doc training
- §10 plans to force all users to reset passwords during cut-over
  (because the vendor hash is "likely incompatible").
- The vendor onboarding doc trained users to **re-enter
  `TEST*1234`** on the first forced-change prompt, not to pick a
  new password.
- A mass reset + new password policy right at cut-over will create
  a support spike.
- **Fix.** Add a row to the §10.10 risk table: staged per-cluster
  reset starting **14 days before cut-over**, with out-of-band
  comms to each AF. Issue updated training materials before wave 1.

---

## 3. Open MEDIUM — over-specification to strip

The spec states specific tuning values and toolchain picks that
belong in a separate `defaults.md` addendum, not in the requirement
text. Extracting these lets the spec state _what_ and the addendum
state _how_.

| Item | Location | Current (implementation detail) | Keep in spec |
|---|---|---|---|
| Argon2id `t=2, m=19456, p=1` | §8.3 | Specific params + `ARGON2_PEPPER` secret | "Memory-hard hash, configurable params, global pepper" |
| Session TTL 12h, OTP 10min, presign 15/60min, idempotency 24h | §8.4 | Exact numbers | "Configurable; operational defaults documented separately" |
| JS budget 180 KiB / CSS 20 KiB / HTML 8 KiB | §8.2 | Exact numbers, specific tooling (size-limit) | "First-load budget enforced in CI" |
| React + Vite, pnpm, drizzle-kit, Workbox, Grafana Cloud | §11.2, §11.10, §8.8 | Named tools | "SPA framework TBD; one i18n composite font; PWA Service Worker; metrics backend TBD" |
| Cron `0 2 * * *` | §11.3 | Exact schedule | "Daily, off-peak IST" |
| Argon2 pepper, OTP provider enumerated (MSG91/Twilio/Kaleyra) | §11.9 | Named providers | "OTP provider TBD (§11.12 open item)" |

**Fix.** One addendum doc — `requirements/defaults.md` — that lists
every concrete default with a one-line justification. The spec
files link to it.

---

## 4. Open MEDIUM — under-specification to tighten

### U2 — SLO denominator
- §8.13 "outbox drain success rate ≥ 98 %" — per item, per run,
  per user, per day?
- **Fix.** Write: _"per (user, UTC day), counted as items
  successfully committed / items enqueued that day."_

### U4 — `scope_id` has no DB-level FK
- §4.3.1 — enforced in application code only.
- **Fix.** Either (a) accept the soft invariant and document it
  explicitly in §4.1 conventions, or (b) move to a junction table
  (pairs with H1 path B).

### U7 — Donor-facing media use has no consent surface
- §9.1 lists the child PII the app stores (including photos); §9
  is silent on external sharing. §3.9 (donor engagement) currently
  assumes every `/api/media` row is donor-shareable — a placeholder
  that must close before public launch or before the workflow
  extends beyond a single Super-Admin operator.
- **Fix.** Add `donor_shareable BOOLEAN DEFAULT 0` and
  `donor_consent_captured_at` columns to the `media` row (§4). Add
  a consent-capture step to §3.4 (likely per-media or per-event
  opt-in by the uploader, attested by guardian). Update §5.8
  list/get responses to always return the flag. Remove the
  "assume shareable" language from §3.9.3 and the stand-in note
  in `skills/donor-update/SKILL.md` once shipped.
- **Sequencing.** Low-risk to defer while donor engagement is a
  single-operator workflow with manual review. Must land before
  the capability in §2.3 extends to Cluster Admins or donors ever
  see media through a self-serve portal.

### U8 — `avg_children` denominator (§3.6.2 consolidated KPI)
- §3.6.2 lists "average children" among the consolidated KPIs
  without pinning the denominator. L2.5.3 ships it as
  `total_marks / total_attendance_sessions` — i.e. *all scheduled
  sessions*, including sessions that happened but had zero
  attendance marks. That can pull the average down when a session
  was logged but nobody showed up.
- **Decision prompt.** Keep the current definition (scheduled
  sessions) or tighten to "sessions with at least one mark"
  (held-and-non-empty)? Flagged by PR #31 review #6.
- **Fix.** Write the rule into §3.6.2 under the KPI list, the
  way D13 pins image % / video %. If ops chooses
  "held-and-non-empty", change `consolidatedAvgChildren` in
  `apps/api/src/routes/dashboard.ts` to `total_marks /
  sessions_with_marks`.

### U9 — Public program APIs: rate limit not yet enforced (§5.19 rule 6)
- §5.19 requires Cloudflare Rate Limiting on `/api/programs/*` at
  60 req/min/IP. The runtime ships without it; today a single IP
  can drain the public surface (and through it the D1 budget the
  authenticated app shares).
- **Sequencing.** Deferred — we are currently on dummy data with
  no public consumers. Wire the rule before the first real
  embedder goes live (typically alongside L5 production
  hardening, since both need a real Cloudflare account zoned
  against `navsahyog.org`).
- **Fix.** Cloudflare dashboard → Security → Rate Limiting Rules,
  scoped to path prefix `/api/programs/`, threshold 60 req/min
  per source IP, action `block` or `challenge`. Pin the exact
  threshold in `requirements/defaults.md` once that file lands.

### U10 — Public program APIs: production CORS allowlist not yet wired (§5.19 rule 5)
- §5.19 requires production to tighten the public-API CORS from
  `Access-Control-Allow-Origin: *` to an env-driven allowlist of
  embedder origins (`navsahyog.org` + partner sites). The runtime
  currently returns `*` unconditionally — fine for the dummy-data
  phase but a free-rider risk in production.
- **Sequencing.** Deferred until the prod embedder origins are
  actually known. Same gating as U9 — both belong in the L5
  production-readiness pass.
- **Fix.** Add a Worker env var `PUBLIC_PROGRAM_ALLOWED_ORIGINS`
  (comma-separated). The `/api/programs/*` CORS branch in
  `apps/api/src/index.ts` falls back to `*` when the var is
  empty (dev / staging) and switches to a credential-less
  origin allowlist when populated. One test in
  `apps/api/test/programs.test.ts` already covers the wildcard
  branch; add a sibling test for the allowlist branch when the
  var lands.

---

## 5. Open LOW

- **L1.** §7.7 retention discussed in §9.3 and §7.7 with slight
  wording drift. Consolidate in §9.3 and leave §7.7 as a pointer.
- **L2.** §2.2 says Country is fixed as India — but the schema
  (§4.3.2) has no `country` table. That's correct but not called
  out. Add one line to §4.3.2: "Country is hardcoded to India; no
  `country` table."
- **L3.** §5.8 `/api/media/presign` returns a multipart init token
  "when `bytes > 10 MiB`"; §7.3 says "Objects > 10 MiB". Same
  threshold, but spelled out separately in each. Pick one.
- **L4.** §10.5 uses `LoginId` / `PwdHash` / `CorpId` in
  PascalCase quoting the vendor; all other references use snake_case.
  Pick one convention and footnote.
- **L5.** §11.11 cost envelope labels Cloudflare Images as "if
  used" and then §11.3 binds it. Decide and align.
- **L6.** §7.4 derived renditions (thumbnails / video posters)
  deferred via decisions.md D11. Until the `media-derive` Queues
  consumer + Cloudflare Images / wasm-vips call ships, list and get
  endpoints return the original R2 key as both `url` and `thumb_url`.
  Pick between the two backends (§7.9 open item) and land the
  consumer when a real workflow needs it.
- **L7.** **IST-vs-UTC date bucketing drift across date-keyed
  queries.** Fixed in `consolidatedMediaPct` (PR #31 L2.5.3) by
  applying `'unixepoch', '+5 hours 30 minutes'` to `captured_at`
  before the `date()` compare. The same drift lives in
  `insights.ts` (`strftime('%Y-%m', captured_at, 'unixepoch')` at
  lines ≈ 243 and 323) and in any future query that compares
  `captured_at` to an IST calendar date. Sweep these in a later
  fix — not a regression, but newly user-visible wherever the
  numbers feed a KPI. Flagged by PR #31 review #5.
- **L8.** **Clerk integration architecture resolved — see D36.**
  The Clerk SDK was wired into `apps/web` ahead of L5 on branch
  `claude/add-clerk-auth-xGMCK`. The architectural questions
  this entry originally raised (bridge vs replace homegrown
  session, role mapping shape, Worker-side JWT verification)
  are resolved by D36 (four-layer split: Clerk for online
  identity, Worker for authz + cookie session, PWA for offline
  cache + outbox, Worker again for sync-time final authority).
  Implementation is tracked under D36's "What ships" list, not
  here. The §9 residency question (whether Clerk's US data
  plane is acceptable for identity-only) is the only open
  reconciliation that survives D36 and is carried in D36's open
  follow-ups against L5 / §9.

---

## 6. Decisions still needed

1. **H1** AF ↔ Cluster: 1:1 or many:many?
2. **H4** Password-migration staging plan: how many waves, how
   long, who owns comms?
3. **U2** SLO denominator wording for §8.13.
4. **U4** `scope_id` FK: soft invariant or junction table (pairs
   with H1 path B)?
5. **U7** Donor consent surface — gates extending donor engagement
   beyond single-operator review.
6. **U8** `avg_children` denominator (scheduled vs held-and-non-empty).
7. **U9 + U10** Public-API rate limit + CORS allowlist — gated on
   first real embedder going live.
8. §9.6, §4.5, §5.17, §6.13, §7.9, §8.14, §10.11, §11.12 remaining
   open items (mostly covered above; see §11.12 for the full list).

---

## 7. Next steps

1. Land each decision above in `requirements/decisions.md`,
   dated, with a one-line justification.
2. Split `requirements/defaults.md` out from §§8 and 11 (the
   over-specification table in §3 above).
3. Edit each affected section of the spec to reflect decisions;
   one PR per section to keep reviews tractable.
