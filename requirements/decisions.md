# Decisions

[← Index](./README.md)

Outcomes of review-findings discussions and MVP session calls. This
file is the **durable record** — the spec text is updated to match
in the same commit the decision lands. Each row has a one-line
justification.

---

## 2026-04-29 — Authentication architecture: four-layer split (Clerk + cookie-session hybrid)

| # | Decision | Supersedes |
|---|---|---|
| D36 | **Auth is split into four layers, each with one job and a clean boundary so any layer can be swapped without touching the others. Layer 1 (online identity) is Clerk: `<SignIn />` widget for sign-in, no public sign-up, admin user provisioning via the Clerk dashboard, MFA / password reset / email verification handled by Clerk. Layer 2 (authorization + device/session policy) is the Worker: it owns the local `user` table, the role / scope / capability matrix from §2.3, the cookie-session lifecycle (30-day sliding, secure, httpOnly, SameSite=Lax), and revocation. Layer 3 (offline cache + mutation queue) is the PWA: IDB read-cache, outbox, manifest pull on session resume — all already built in L2.5/L4.0. Layer 4 (final authority at sync time) is the Worker again, re-validating each outbox replay against the *current* capability matrix, not the matrix that was active when the mutation was queued. Clerk's JWT only ever touches the request path **once**, at `POST /auth/exchange` — the Worker verifies it, looks up `user` by `clerk_user_id`, mints a long-lived signed session cookie, and Clerk is out of the loop until the cookie expires or the user signs out. Every subsequent request uses the cookie, exactly like today's flow. Three policy commitments ride with this: (a) **30-day sliding cookie + immediate revocation via Clerk webhooks** — the Worker accepts the cookie offline indefinitely within its TTL, but `user.deleted` / `user.updated` webhooks invalidate the local session row at next online check; (b) **dual-path Clerk → local user sync** — Svix-verified webhook keeps the local table fresh, and `/auth/exchange` self-heals if the local row is missing by looking up the user via Clerk JWT email claim and linking, so first-sign-in does not depend on webhook delivery timing; (c) **outbox carries auth context** — each queued mutation records the `user_id` and scope it was created under, but layer 4 re-validates against the live capability matrix at replay time, so a role change between offline-write and replay does the right thing (revoked permission rejects, granted permission accepts). The portability story is structural: dropping Clerk later changes one widget (`<SignIn />`) and one endpoint (`/auth/exchange` → `/auth/login`); layers 2-4 are provider-agnostic and stay. The §9 residency surface is also smaller than a Clerk-everywhere integration would be — Clerk only sees emails, sign-in events, and password-reset traffic; session activity, role data, audit trail, and all app reads/writes stay in D1. | The earlier review-findings §5 L8 entry that flagged the Clerk integration as preview-only with three open reconciliations (bridge sessions, decide residency, verify Clerk JWTs in apps/api). D36 resolves the architectural shape; the residency call (whether Clerk's US data plane is acceptable for India-only single-tenant identity) remains open under §9 and is not gated by D36 — if the answer is "no", layer 1 swaps for a self-hosted IdP and layers 2-4 are unchanged. |

### What lands with this decision

- **`requirements/decisions.md`** — this row.
- **`requirements/review-findings-v1.md` §5 L8** — trimmed to a back-pointer to D36; the three open questions in the original entry are either resolved (architecture) or carried into D36's open follow-ups (residency).
- No spec section is rewritten yet. §5 endpoint gates, §9 compliance, and §11 Cloudflare mapping all need updates when the L5 implementation slice lands; at that point the spec edits ride with the implementation PR.

### What ships in implementation (next, on this branch)

In order, each step independently committable:

1. **D1 migration** — add `clerk_user_id TEXT UNIQUE` + `clerk_synced_at INTEGER` to `user`. Migration is purely additive; existing seed users keep working until the seed script (step 5) back-fills the column.
2. **Worker `/auth/exchange`** — verifies Clerk JWT via `@clerk/backend` (cached JWKS), looks up `user` by `clerk_user_id`, self-heals via email lookup if missing, mints the session cookie. Reuses the existing cookie shape and `requireAuth` middleware unchanged.
3. **Worker `/webhooks/clerk`** — Svix-verified, handles `user.created` / `user.updated` / `user.deleted`. The first two upsert the local row; the third invalidates any active session.
4. **Client swap** — `Login.tsx` is replaced by Clerk's `<SignIn routing="path" path="/sign-in" />`. `AuthProvider` keeps the same `useAuth()` interface (so the 14 consumer files don't change), but its bootstrap now runs `api.exchange(clerkToken)` after Clerk sign-in. `api.login` is dropped; `api.me` and `api.logout` stay.
5. **Seed bridge script** — `apps/api/scripts/seed-clerk.ts` creates Clerk users for the dummy seed accounts (`vc-anandpur`, `af-tehri`, `super-admin`, etc.) via Clerk's Backend API, captures the returned IDs, and back-fills `clerk_user_id` on the local rows. One-shot, idempotent, dev-only.
6. **Outbox auth context audit** — confirm the existing outbox row shape carries `user_id` and scope (it should; it predates this decision), and add a layer-4 replay test that revokes a capability between queue and replay and asserts the replay rejects. If the row shape is missing context, this step adds the column.
7. **Disable sign-up + email allowlist in Clerk dashboard** — operational, documented in §11.9 secrets / runtime-config notes when L5 lands.

### Knock-on effects

- **L5 unblocked partially.** L5 was originally framed as "auth + compliance"; D36 lands the auth half of L5 ahead of schedule on `claude/add-clerk-auth-xGMCK`. The compliance half (residency, audit-log retention, breach response) stays L5-future and is not gated by D36.
- **L4 offline survives unchanged.** The PWA's offline behaviour is identical post-D36 — it talks to the Worker via the same cookie, the Worker doesn't talk to Clerk during normal operation, and the manifest pull / outbox replay loops are untouched. This was the load-bearing requirement; the four-layer framing is what makes it free.
- **§10.5 vendor-data parity stays clean.** The local `user` table keeps its full shape (`id INTEGER`, `user_id TEXT`, `full_name`, `role`, `scope_level`, `scope_id`); the new column is additive. A future vendor-data import maps `LoginId` → `user_id` and creates a Clerk account per imported row via the Backend API at import time.
- **§9 residency call is contained.** Clerk only sees identity events. Whatever §9 ultimately rules on identity-data residency, no other layer needs to move.

### Open follow-ups

- [ ] During implementation: confirm the existing `requireAuth` middleware reads the cookie shape `/auth/exchange` will mint. The shape should be unchanged from `/auth/login`'s output today; if there's any drift, exchange matches login and the diff is zero.
- [ ] During implementation: decide whether `/auth/logout` calls Clerk's `signOut` server-side (so the Clerk session ends too) or only clears the local cookie (Clerk session ages out on its own). Default: only clear local; Clerk-side sign-out is best-effort from the client via `useClerk().signOut()` in the same hook.
- [ ] L5 / §9: the residency decision. If "Clerk US data plane is acceptable for identity-only," D36 is the final shape. If not, layer 1 swaps for a self-hosted IdP (Ory Kratos, Keycloak, or roll-your-own) and the rest is unchanged. The four-layer framing is what makes this a contained migration rather than a rewrite.
- [ ] L5 / §10.5: when vendor-data import lands, decide whether to import bcrypt password hashes into Clerk (Clerk's Backend API supports it) or force-reset all users at cutover. Force-reset is operationally simpler but worse UX; hash import is one-time complexity for better cutover. Decide closer to L5.

---

## 2026-04-29 — Offline child creation under visibility-after-sync

| # | Decision | Supersedes |
|---|---|---|
| D35 | **`POST /api/children` is `offline-eligible` (additive-only contract surface), and offline-created children follow a *visibility-after-sync* rule: they do not appear in any read screen — not in `cache_students`, not in the village children list, not in the achievement picker — until the drain succeeds and the next manifest pull lands.** Allowing offline child creation matters because a VC's first interaction in a village is often "register a new child"; refusing offline would block that path on every connectivity gap. The simpler alternative (placeholder UUIDs that resolve on drain, with FK rewrites for any achievement / attendance row referencing them) was considered and rejected: it adds a stateful drain protocol, complicates conflict resolution, and creates a UX cliff if the placeholder fails validation post-hoc. The visibility-after-sync rule is the working-principle-5 ("no optimistic UI") posture applied consistently — server is the truth, the cache reflects the server, the outbox is just queued intent. The trade-off the field will see: a VC who creates a new child cannot record an achievement for them in the same offline session. They must wait until the next online window for the child to appear in pickers. The offset against this cost is the elimination of an entire class of merge / rewrite bugs. | The earlier `requirements/06-offline-and-sync.md` §6.6 wording that left the offline-create policy implicit ("Student creation offline is allowed. If the server rejects on validation … the user resolves in the outbox screen") and the open item in `requirements/offline-scope.md` ("Decide the policy on offline student creation"). Both were resolved by D35 and updated in the same commit. |

### What lands with this decision

- **`requirements/offline-scope.md`** — new row for §3.2.2 "Add child"
  flipping `POST /api/children` from `online-only` (the default) to
  `offline-eligible`, with the visibility-after-sync rule called out
  in the Notes column. The pre-existing open item ("Decide the
  policy on offline student creation") is marked resolved with a
  back-pointer to D35.
- **`requirements/06-offline-and-sync.md` §6.6** — the
  one-paragraph "Student creation offline" bullet is replaced with
  the explicit visibility-after-sync framing, and a back-pointer
  to D35.
- No other §3 / §5 / §11 changes ride with D35 — those changes
  belong to the L4.1b implementation slice that wires the form +
  outbox + manifest pieces together. Keeping the contract surface
  (this PR) and the implementation (next PR) separate matches the
  process rule in `requirements/offline-scope.md` for adding a
  workflow as `offline-eligible`.

### Knock-on effects

- **L4.1 slicing**: D35's visibility-after-sync rule decouples the
  achievements vertical slice (L4.1a — pick from already-synced
  students, write achievement to outbox) from offline child creation
  (L4.1b — create child to outbox, picker only sees them on next
  manifest pull). Both can ship independently.
- **L4.0d additive-only contract harness**: `POST /api/children`
  joins the offline-eligible endpoint set, so its payload joins the
  L4.0d regression corpus when L4.1b lands. The first corpus entry
  has not yet shipped, so D35 doesn't change today's CI behaviour;
  it sets the rule for next week's PR.

### Open follow-ups

- [ ] During L4.1b: confirm the existing `POST /api/children`
      handler accepts an `Idempotency-Key` header and returns the
      same response on a duplicate replay (the outbox runner relies
      on this — §5.1). The server-side idempotency cache predates
      the offline ladder, so a small audit will tell us whether any
      shape changes are needed.
- [ ] During L4.1b: pick the dead-letter UX for a duplicate
      (name + DOB + village + parent_phone) collision. The current
      §6.6 wording says "the user resolves it from the outbox
      screen" — the L4.0d Outbox UI already supports re-edit /
      discard, so this is likely a label question, not a code one.

---

## 2026-04-29 — Shell service worker (overrules L4.0c "no SW")

| # | Decision | Supersedes |
|---|---|---|
| D34 | **Ship a minimal shell-only service worker + Web App Manifest so an Add-to-Home-Screen PWA loads when the device is offline. The SW caches the app shell (HTML, JS, CSS, images) keyed by APP_BUILD; old-build caches purge on activate. Every data endpoint (`/api/*`, `/auth/*`, `/health`) bypasses the cache so offline-eligible workflows still fail fast and surface the spec'd offline UX. Empirical trigger: an iOS Safari Add-to-Home-Screen install with airplane mode enabled lands on a blank shell because no SW is registered to satisfy the navigation request — the field-tested baseline that L4.0c assumed "data-offline workflows are enough" turns out not to cover.** Field reality on iOS Safari is that without a SW the launcher icon resolves to a network-load attempt that fails outright when offline, so the app shell never paints. Caching the shell costs nothing on the data contract surface: it's URL-keyed by build, so a deploy automatically invalidates, and the runtime never touches data routes. The N-7 compat window in D31 still applies — the SW's cache lifetime tracks the same `APP_BUILD` identifier, so an out-of-window build flushes its old shell and the upgrade banner still drives the user to refresh. iOS PWA is the immediate motivator (active testing on iOS even though Android is the bulk of users); Android Chrome benefits identically. | L4.0c's *"No service worker — the soft signal travels on response headers, which is enough for data-offline workflows."* L4.0c stays correct for the *data* layer; the shell-load gap on iOS Safari was simply not in scope when that decision was taken. |

### What lands with this decision

- **`apps/web/public/sw.js` (new):** the shell SW — install caches a
  small bootstrap set, fetch handler is network-first for navigation
  with cache fallback, cache-first for hashed assets, pass-through
  for `/api`, `/auth`, `/health`. Cache key embeds `APP_BUILD` from
  the registration query string.
- **`apps/web/public/manifest.webmanifest` (new):** Web App Manifest
  — name, short_name, start_url, display=standalone, theme_color,
  icons. Wired in `index.html` alongside iOS-specific
  `apple-touch-icon` + `apple-mobile-web-app-*` meta.
- **`apps/web/src/lib/sw.ts` (new):** registration helper, called
  from `main.tsx` only when `import.meta.env.PROD` (dev mode skips
  registration so HMR is unaffected).
- **Spec'd offline UX bug fixes:**
  Home (§3.6.4) and Dashboard (§3.6) now render the
  `OfflineUnavailable` card when fetch fails *and* the network is
  detected as offline, instead of latching on the loading skeleton
  or rendering a raw error. Matches the offline-scope.md row that
  says these screens are `online-only` with a "data unavailable"
  empty state.
- **Sluggishness mitigations:**
  Achievements page no longer fans out one `GET /api/children` per
  visible village when no filter is set; the form fetches its own
  picker source on demand. The network-detection cache stretches to
  2 minutes when offline, and the chrome's poll interval matches —
  an iOS PWA in airplane mode no longer spends a 3s timeout every
  30s on the bare chance the radio came back. The `online` window
  event still force-probes immediately, so recovery is event-driven.

### Open follow-ups

- [ ] Square PWA icon assets at 192×192 and 512×512. The current
      `logo.png` (281×321, non-square) covers the manifest but iOS
      will letterbox at install time. Low-effort follow-up; not a
      blocker for the offline fix.
- [ ] Audit other `online-only` read screens (Masters, Training
      Manuals, Ponds list) for the same loading-skeleton-forever
      bug Home and Dashboard had. Likely the same one-line fix per
      page.

---

## 2026-04-27 — L4.0e (replay tool + cache integrity) deferred

| # | Decision | Supersedes |
|---|---|---|
| D33 | **The two L4.0 platform items not landed in L4.0a–d — the internal replay tool and the cache integrity check — are deferred, not omitted.** Both have a "wait until something else lands" dependency that makes shipping them now low-value. **Replay tool**: a CLI / staging endpoint that takes an exported outbox dump from a problem user and replays it against staging. Genuinely useful only once we have field users with real outbox state to debug; lab-only mode lets engineers inspect IDB via DevTools, which covers the same need at zero engineering cost. Revisit when L5 lands real data. **Cache integrity check**: a per-online-session checksum compare between cached scope and a server-computed value, with drop-and-resync on divergence. Only meaningful if cache stores exist; L4.0a–d ships only the `outbox` store. The cache stores (`cache_villages`, `cache_schools`, `cache_students`, `cache_events`) arrive with L4.1's manifest sync, so the integrity check folds naturally into that PR rather than shipping speculatively here. **L4.0 is functionally complete** with L4.0a–d; "L4.0e" exists in the ladder only as a marker for these two deferred items. | The original L4.0 in-scope list in `mvp/level-4.md` that listed both items as platform deliverables. The platform doesn't *need* them to enable L4.1 onboarding — adding them now would be premature work for a future scenario. |

### Status

- **Replay tool** — revisit when real users / real PII / real
  field deployment lands (L5 territory, possibly later).
- **Cache integrity check** — fold into the L4.1 PR that
  introduces cache stores. Tracked here so it's not silently
  forgotten.

---

## 2026-04-27 — L4 reframed as offline-as-platform

| # | Decision | Supersedes |
|---|---|---|
| D29 | **L4 is reframed from "3-workflow lab demo" to "offline-as-platform". The level ships in three sub-levels: L4.0 platform (versioned outbox + IDB migrations + service-worker upgrade + build-id + CI regression corpus + dead-letter UX), L4.1 the original §6.1 three workflows onto the platform, and L4.2+ progressive per-workflow opt-in.** Field reality is that most VC / Cluster data-capture workflows want to be offline-eligible, and the team will keep iterating on schema and endpoints after deploy — building offline narrowly now and retrofitting iterability later is the path that produces brittleness. The platform-first ordering means each L4.2+ workflow is a route registration plus a row in `offline-scope.md`, not an outbox-processor change. The original `level-4.md` plan (3 workflows, lab-only) lands as L4.1 inside this larger frame. | The original `mvp/level-4.md` "lab-only architecture validation" framing — the goal flips from "validate the architecture for an unspecified future" to "build the platform that production iteration depends on". |
| D30 | **`requirements/offline-scope.md` is the authoritative contract surface for offline functionality, and offline-eligible endpoints are bound by an additive-only contract.** The new doc lists every workflow as `online-only` / `offline-eligible` / `offline-required`. Anything in the latter two categories cannot rename, remove, or tighten a field — those are breaking changes that require a new endpoint version. New nullable fields are fine. A CI regression corpus replays real payloads from each release against the current server; a failing payload blocks merge. Adding a workflow to the doc requires a D-numbered decision; flipping it back to `online-only` is a multi-release deprecation (drain existing queued items first). | §6's earlier implicit framing where "what's offline" was scattered across §3.7 + §6.1 + the field-team's heads. Centralising it into one editable doc is the precondition for the additive-only rule to actually be enforceable. |
| D31 | **Client compat window is N-7: same-day upgrade preferred, end-of-week the hard ceiling. Server adapters for offline-eligible endpoints cover the last seven days of builds; outbox items older than that dead-letter on drain. A "Update required" screen blocks new client-side queueing past the window.** Without an upgrade SLA, the server's compat surface grows unbounded — adapters multiply, dead code accumulates, and the additive-only contract becomes much harder to keep coherent. A bounded window turns adapters from a long-tail problem into a small known set. The screen is what makes the SLA enforceable on devices, not just a doc claim. | An open-ended "support whatever client is in the field" model — that is the operational shape that makes offline brittle. |
| D32 | **§6.4's manifest delta protocol (`since=…`) is replaced by a full-snapshot manifest scoped to the user's authority, and the offline-eligible workflow set is governed by ten operational principles (level-4.md "Working principles").** Per-user scopes are kilobytes (one village, dozens of students, dozens of events) — the delta protocol's complexity (timestamps, tombstones, ordering, fence tokens) buys nothing at that size. Replace-snapshot is one HTTP fetch per refresh, no merge logic. The ten principles (online-only default, additive-only, N-7 window, one mutation per workflow, no optimistic UI, scope-bound caching, replace-snapshot, foreground-only sync, server-as-truth, hard outbox cap) are the operational shape that keeps the platform surviving iteration. | §6.4's `since=…` delta protocol; §6.13's "pick manifest granularity" open item (resolved by snapshot replace); the implicit per-workflow optimistic-UI / draft / merge surface that field workflows tend to grow under pressure if the principles aren't named explicitly. |

### What lands with this decision

- **`requirements/offline-scope.md` (new):** the contract surface
  doc — workflow inventory by §, status (`online-only` /
  `offline-eligible` / `offline-required`), owner, notes. Indexed
  from `requirements/README.md`.
- **`requirements/06-offline-and-sync.md`:** new §6.0 "Offline
  contract (L4 amendment)" subsection at the top of §6 pointing
  at the new doc and naming the four rules. §6.4 marked superseded
  by snapshot replace.
- **`mvp/level-4.md`:** redrafted around the three sub-levels
  (L4.0 platform / L4.1 onboard / L4.2+ progressive), ten working
  principles, per-sub-level scope and acceptance, watch-out for
  the L5 auth re-test.
- **No code or schema changes in this commit.** Implementation
  lands in subsequent L4.0 PRs.

---

## 2026-04-26 — L3.3 Jal Vriddhi pond + agreement form

| # | Decision | Supersedes |
|---|---|---|
| D25 | **Jal Vriddhi gets its own first-class workflow surface (§3.10) — three new tables (`farmer`, `pond`, `pond_agreement_version`), a new `pond.write` / `pond.read` capability pair, and a dedicated form / list / detail UI.** Up to now Jal Vriddhi existed only as one of nine `event.kind = 'activity'` rows used to tag photos. The new request — VC populates farmer + GPS + uploads a signed agreement, with full version history — does not fit the child-development surface (no `student`, no `attendance_session`), so the new entity types are scope-bound to `village` but otherwise standalone. Schema slotted as **§4.3.10** (out-of-source-order so §4.3.9 Audit keeps its existing cross-references) and routes as **§5.18** (same reasoning vs §5.16 / §5.17). Capability matrix in §2.3 grows two rows; matrix-as-data in `packages/shared/src/capabilities.ts` adds `pond.read` to the read-only base + `pond.write` to the write tier. **Online-only**: pond creation is rare relative to attendance and the agreement file is the high-stakes artefact in the workflow — better to fail fast on a bad-network day than risk a placeholder version. | Earlier framing that left "Jal Vriddhi" implicit as a media tag. |
| D26 | **Agreements are append-only versions, never overwrites.** Re-uploading creates a new `pond_agreement_version` row with `version = MAX(version) + 1`; the prior R2 object stays in place. The "current" agreement is `MAX(version) WHERE pond_id = ?`. There is no PATCH or DELETE on `pond_agreement_version` at the API surface; soft-deleting a pond hides the chain but leaves the version rows in place for audit. Each new version may carry an optional 200-char "what changed" note (free-text — no enum) so the audit value is captured without forcing a taxonomy that hasn't been designed. | Any "edit-in-place" framing that would have made the agreement a single mutable column on `pond`. |
| D27 | **Agreement uploads ride a parallel HMAC token machinery, not the media token.** The media token signs `kind` (image/video/audio) and `village_id`; agreements have no `kind`, sign `village_id` only, and a shorter MIME allow-list (`application/pdf`, `image/jpeg`, `image/png`). The token version marker is `agreement-v1`, distinct from media's `v1`, so a media-presign token cannot be replayed against `/api/ponds/agreements/upload/:uuid`. The R2 binding is reused (single bucket); top-level prefix `agreement/` keeps the listing namespaces separate. The presign is bound to a `village_id` (scope check) but not to a `pond_id` — the same presign serves both initial-create and re-upload flows, with the `pond_id` binding happening server-side at commit. **Cap is 25 MiB** (vs media's 50 MiB) — agreements are scanned PDFs and image scans, not videos. | An earlier shape that overloaded the media presign for agreement uploads. The token coupling and the kind-shaped allow-list both leaked badly enough that two narrow tokens read cleaner than one generic one. |
| D28 | **Read access is broad, write is village-scoped.** `pond.read` is granted to every authenticated role including read-only geo admins (District+) — the agreement trail is exactly the kind of artefact those audits depend on. `pond.write` is granted to VC / AF / Cluster Admin / Super Admin, mirroring how attendance and media writes are gated. There is no separate "originating VC only" rule on re-uploads — any user with `pond.write` whose effective scope covers the pond's village can append a new version. Phone is collected as Indian mobile (validated via the existing `isIndianPhone`) but optional; KYC / Aadhaar capture for the farmer is **explicitly out of scope** until §9 calls for it. | An earlier draft that gated re-upload to the originating VC only — too narrow once a pond outlives the original VC's posting. |

### What the implementation PR ships (lands with this commit)

- **Schema:** `db/migrations/0010_pond_agreement.sql` — three new
  tables (`farmer`, `pond`, `pond_agreement_version`) with the
  indexes called out in §4.3.10. No FK consumer yet on
  `pond_agreement_version` — append-only by design.
- **Capabilities:** `packages/shared/src/capabilities.ts` adds
  `pond.read` to `READ_ONLY` and `pond.write` to the `WRITE`
  layer. Both ride the existing `requireCap(...)` middleware in
  `apps/api/src/policy.ts` — no new gating shape.
- **Shared types:** `packages/shared/src/pond.ts` — wire shapes
  for `Farmer`, `Pond`, `PondAgreementVersion`, the list / detail
  views, and the presign / commit request bodies. Re-exported
  from `packages/shared/src/index.ts` so server + client read
  from the same module.
- **API routes:** `apps/api/src/routes/ponds.ts` (new file) wires
  the seven endpoints from §5.18. `apps/api/src/lib/agreement.ts`
  carries the parallel HMAC machinery (D27). `index.ts` adds the
  staging-basic-auth carve-out for the token-gated upload PUT
  and routes `/api/ponds` into the new tree.
- **UI:** `apps/web/src/pages/PondNew.tsx` (create form),
  `Ponds.tsx` (list), `PondDetail.tsx` (versions + re-upload).
  `apps/web/src/lib/agreement.ts` carries the client-side
  presign → PUT helper. `App.tsx` adds three routes gated on
  `pond.read` / `pond.write`; `Shell.tsx` adds the nav link gated
  on `pond.read`.
- **i18n:** `pond.*` namespace added to all four catalogs
  (en + hi + kn + ta) plus `nav.ponds`. Hindi gets full
  translations; Kannada and Tamil ship with reasonable
  approximations consistent with prior levels' standards (would
  benefit from a native-speaker pass before public launch — same
  posture as L1/L2 strings).

---

## 2026-04-26 — L3.1 Master Creations scope + delivery

| # | Decision | Supersedes |
|---|---|---|
| D21 | **L3.1 ships Master Creations as a single slice covering five masters: villages, schools, events / activities, qualifications, users — list + create + edit only, no soft-delete.** One dedicated screen per master, surfaced as five tabs on `/masters` (not a generic table editor, restated from §3.8.7 so it isn't relitigated). The five share enough scaffolding — `requireCap(...)` gates, list / create / edit form shape — that splitting them buys two rounds of the same review without buying isolation. **Soft-delete is carved out of L3.1**: the existing schema has no `deleted_at` on village / school / event / qualification / user, and adding it would be a 5-table migration + 5 SELECT updates + 5 confirm-dialog UIs, well beyond "list + create + edit". Delete lives in a follow-on slice (call it L3.1.5) once a real workflow needs it. Profile (§3.8.1) is **not** in this slice; it lands as L3.2. "Roles" is **not** a master in this slice — roles are hardcoded in `apps/api/src/policy.ts` per CLAUDE.md, so a creation surface would be dead UI. A read-only "roles & capabilities" reference page can land later if it earns its keep. No bulk import / CSV upload — out of §3.8.7 scope; add only when a real onboarding workflow demands it. **One schema change**: a new `qualification` table (migration `0008_qualification.sql`) — none of the other four masters needed schema changes. | `mvp/level-3.md` "Master Creations + Profile" combined scope (re-sliced for delivery — Profile carved out, Master Creations isolated). Earlier draft that promised soft-delete in this slice (carved out at implementation time once the migration cost was clear). |
| D22 | **Five new write capabilities land in `packages/shared/src/capabilities.ts`: `village.write`, `school.write`, `event.write`, `qualification.write`, `user.write` — granted only to Super Admin per the §2.3 matrix.** Read caps stay broad for the three masters with non-admin consumers (villages / schools / events — dashboards and pickers); for `qualification` and `user` the list endpoints are gated on `*.write` because no non-admin consumer exists yet. The capability matrix lives in `@navsahyog/shared`, not `apps/api/src/policy.ts` — the latter just wires the matrix into a Hono middleware (`requireCap`). Non-Super-Admin POST/PATCH/list-admin returns 403 from the gate, not from a route-internal role check. This closes B3's "structurally read-only via the policy layer" promise for the write side too. | Any earlier framing that put the matrix in `policy.ts` (it's been in `@navsahyog/shared` since L2.0 — D22 just enumerates the five new caps). |
| D23 | **`event.kind` immutability (review-findings H5) is enforced server-side by the L3.1 PATCH route, not just UI-disabled. Closes H5.** PATCH `/api/events/:id` rejects a `kind` change with `409 event.kind frozen — has N referencing rows` once any media (`media.tag_event_id`) or attendance (`attendance_session.event_id`) row references the event. The admin list response carries a derived `kind_locked: 0|1` field; the form reads it and read-disables the kind dropdown when the row is locked. Name + description stay editable regardless. The L3.1 test suite covers both the lock (POST attendance against event 3 → PATCH kind → 409) and the editable surface (PATCH name + description while locked → 200). | H5's open state in `review-findings-v1.md`. |
| D24 | **L3.1 user-create has no password field. Server defaults `users.password` to the lab string `'password'` so newly-created users can log in immediately, matching the L1/L2 seed.** Auth moves to Clerk in L5; introducing a bring-your-own-password surface here would be ripped out wholesale at that point and would also leak an inconsistent partial security posture (some passwords operator-set, some `'password'` from the seed, none hashed). The form carries a one-line note explaining the L5 plan. The `password` column itself stays in the schema until Clerk lands; L5 then either drops it or repurposes it for the Clerk user_id. | Earlier draft of D24 that exposed a plain-text password field on the create form. The decision flipped once Clerk was confirmed as the L5 auth path. |

### What the implementation PR ships (lands with this commit)

- **Schema:** `db/migrations/0008_qualification.sql` — new `qualification` table (id, name UNIQUE, description, created_at, created_by). `db/seed.sql` adds `DELETE FROM qualification` to the reset block in FK-topology order.
- **Capabilities:** `packages/shared/src/capabilities.ts` adds the five `*.write` caps, plus a `SUPER_ADMIN_ONLY` array layered onto the super_admin row.
- **API routes:**
  - `villages.ts` — adds `GET /admin`, `POST /`, `PATCH /:id`. Existing `GET /` (scope-filtered for non-admins) is unchanged.
  - `schools.ts` — adds `GET /admin`, `POST /`, `PATCH /:id`. Existing per-village `GET /` unchanged.
  - `events.ts` — adds `GET /admin` (returns `reference_count` + `kind_locked`), `POST /`, `PATCH /:id` (enforces D23).
  - `qualifications.ts` — new file: `GET /`, `POST /`, `PATCH /:id` (all gated on `qualification.write`).
  - `users.ts` — new file: `GET /` (all users, scope_name resolved via CASE-WHEN), `POST /` (no password in body, server defaults to `'password'`), `PATCH /:id` (role change resets the scope_id requirement).
  - `geo.ts` — adds `GET /all` (admin-only geo dump for the user-create scope picker).
  - `index.ts` — wires `qualifications` and `users` route trees.
- **Tests:** `apps/api/test/masters.test.ts` — 30 new tests covering POST/PATCH happy paths, capability-gate 403s, duplicate-key 409s, `event.kind` immutability (closes H5), and the user-create lab-password round-trip (created user logs in with `'password'`).
- **UI:** `apps/web/src/pages/Masters.tsx` — single page, five tabs, list + inline create/edit form per master. `Shell.tsx` gains a Masters nav link gated on `user.write`. `App.tsx` gates the `/masters` route on `user.write` so non-admins can't bookmark in. `apps/web/src/api.ts` gains the wire shapes + client functions for every endpoint above.
- **i18n:** `master.*` namespace added to all four catalogs (en + hi + kn + ta), plus `nav.masters`. `scripts/check-i18n.mjs` passes.
- **Test infra:** `apps/api/test/setup.ts` `applySchema()` short-circuits when the schema is already initialised — necessary because `singleWorker:true + isolatedStorage:false` shares the D1 binding across files, and the existing test only works when one file's `beforeAll` runs first.
- **Screenshots:** `mvp/screenshots/l3.1/` — eight images (one per tab + village create form + event kind-locked form + user create form). `scripts/capture-l3.1.mjs` is the harness.

### Follow-on spec / mvp cleanups (same commit as D21–D24)

- `mvp/level-3.md` — sub-levels enumerated (L3.0 doer Home ✅,
  L3.0b observer Home in flight, **L3.1 Master Creations** ✅,
  L3.2 Profile carved out). Status line updated. Acceptance list
  re-numbered to scope each criterion to the sub-level that owns
  it; the list now reflects what actually shipped (no soft-delete
  acceptance, since delete carved out per D21).
- `requirements/03-functional.md` §3.8.7 — no body change; the
  trimmed master list (no roles, no app settings) already matches
  D21. Section header stable per CLAUDE.md numbering rule.
- `requirements/review-findings-v1.md` H5 — marked closed by D23
  in the same commit; the PR ships the test that proves it.

---

## 2026-04-24 — L3.x Field-Dashboard Home

| # | Decision | Supersedes |
|---|---|---|
| D17 | **Introduce §3.6.4 Field-Dashboard Home as the default landing for every authenticated user.** One route `/`, capability-gated composition: doer roles (any `.write` cap) see Greeting + Health Score + Today's Mission + Focus Areas + Capture FAB; observer roles (read-only, District+) see Greeting + Health Score + Focus Areas + Top-N compare snapshot. Same route, different blocks, decided server-side from the caller's capability set — not from role name. VCs with a single village no longer auto-redirect; they land on Home like everyone else. The previous `/` (India-level drill) moves to `/dashboard`. | Current `Home.tsx` which renders the India-level drill directly at `/` and auto-redirects single-village VCs to `/village/:id`. |
| D18 | **Today's Mission is server-picked, doer-only.** Server ranks the four §3.6.2 gaps (attendance %, image %, video %, SoM coverage) as `(target − current) / target` over scope × preset and returns `{kind, current, target, copy}` for the largest. Rendered only for roles with any `.write` cap; observer roles skip the card entirely. Keeps the Home responsive to scope without an SA-curated content table. | Earlier option of a hand-curated weekly mission maintained via Master Creations. |
| D19 | **Observer Home is symmetric with doer Home: same five-block skeleton, with multi-KPI Focus Areas + Compare-all link replacing Mission + FAB. The full sibling-compare grid lives on `/dashboard`, not on Home.** Both branches share Greeting + preset switch + Health Score + Focus Areas (top-3, ranked by Health Score ascending). Doer's row 5 is the Capture FAB; observer's is a single-line "Compare all N children →" link to `/dashboard` with scope and preset preserved. Doer Focus Areas surfaces the dominant-gap KPI per child (action-shaped, "South Cluster needs photo coverage"); observer Focus Areas renders a 4-KPI strip per child (comparison-shaped). The `/dashboard` consolidated fold + sortable drill-down already handle the full-density review with CSV export. Revised from the original D19 that pinned the full grid as the primary observer block — once the doer Home shipped, the asymmetric framing felt wrong, and the full grid genuinely lived more comfortably one tap away on `/dashboard` (bigger viewport, existing sort controls, CSV export). | Original D19: "Sibling-compare grid is the primary block on observer Home." Earlier phrasings that kept the compare grid on `/dashboard` only, and the interim "5-row Top-N snapshot." |
| D20 | **Home time filter is presets only: 7D (default) / 30D / MTD.** Custom from–to picker stays on `/dashboard`. One payload per preset switch; server returns trend deltas against the previous equivalent window (prev 7D, prev 30D, MTD of prior calendar month). Keeps Home scan-in-one-glance and saves an edge-cache key per arbitrary range. | §3.6.1 / §3.6.2's "two date icons" custom range applied to Home as well. |

### Follow-on spec / mvp cleanups (same commit as D17–D20)

- `requirements/03-functional.md` §3.6.4 added (new subsection;
  §3.6.1–§3.6.3 left stable per CLAUDE.md numbering rule).
- `mvp/level-3.md` — In scope gains a "Field-Dashboard Home
  (§3.6.4)" bullet; acceptance list gains a doer-vs-observer
  composition check; title broadened.
- `mvp/README.md` — L3 theme line widened to name the Home.

### Deliberately not pinned in spec (live in `defaults.md` when it lands)

- Health Score weights across attendance / image / video / SoM.
  Worker env vars; tuned out-of-spec per review-findings Medium.
- Exact gap targets for Mission ranking (e.g. "image % target =
  80"). Env vars; §3.6.2 defines the ratios, not the absolute
  thresholds.
- Observer Focus Areas KPI order in the multi-KPI strip (Health
  Score first, then attendance / image / video / SoM, vs. some
  other ordering). Component-level decision; revisit once observer
  roles are in the hands of real users.
- The full sibling-compare grid on `/dashboard` (sortable, CSV-
  exportable). D19 (revised) names this as the path for observer
  density; the grid's exact `/dashboard` shape is component work,
  tracked alongside §3.6.1.

---

## 2026-04-22 — L3 re-scoping + media-backlog visibility

| # | Decision | Supersedes |
|---|---|---|
| D15 | **Cancel §3.8.2–§3.8.6 (Notice board, About Us, Reference links, Quick Phone / Quick Video, Language switcher screen).** None of these were load-bearing for a NavSahyog workflow — they were vendor-platform carryover. Broadcasts, static org info, curated links, and contact numbers are distributed out-of-band (email / WhatsApp). The in-menu language toggle already ships in L2.5; a dedicated switcher screen adds nothing. L3 shrinks to Master Creations (§3.8.7) + Profile (§3.8.1). Section numbers in §3.8 stay (CLAUDE.md numbering rule); bodies replaced with "Cancelled — D15" notes. | Earlier L3 scope that listed all five as "secondary screens" (mvp/level-3.md prior to 2026-04-22). |
| D16 | **L2.4b media-pipeline backlog promoted to a visible row on the MVP ladder.** The follow-on work (P1 — ffmpeg.wasm transcode + R2 multipart; P2 — `media-derive` Queues consumer + thumbnails + EXIF GPS; P3 — AWS4 presigned URLs + MP4/Matroska GPS sidecar) was tracked in `mvp/level-2.4b.md` but not in `mvp/README.md`, so it was easy to miss as "pending scope". Row added between L2.5 and L3; no content change to `level-2.4b.md` itself. | `mvp/README.md` ladder that skipped L2.4b. |

### Follow-on spec / mvp cleanups (same commit as D15 + D16)

- `requirements/03-functional.md` §3.8 — bodies of §3.8.2–§3.8.6 replaced with "Cancelled — D15" notes; §3.8.1 and §3.8.7 updated to reflect the trimmed master list (no more `notices`, `reference_link`, `quick_link`, `about_us` under Master Creations).
- `requirements/04-data-model.md` §4.2 — four content-table rows flipped from **Keep** to **Drop**; §4.3.8 body replaced with a "Cancelled" note (header retained); §4.4 summary drops table count from 21 to 17.
- `requirements/05-api-surface.md` §5.12 — `/api/notices`, `/api/reference-links`, `/api/quick-links`, `/api/about` all removed; section header retained.
- `requirements/06-offline-and-sync.md` — "notices" dropped from the online-only list.
- `requirements/08-non-functional.md` — `user.preferred_language` for "OTP / notice delivery" rewritten as "OTP delivery" (notice delivery cancelled); soft-delete scope drops `notice`, `reference_link`, `quick_link`.
- `requirements/09-compliance.md` §9.6 — i18n open item updated to note the switcher screen is cancelled; in-menu toggle is the only affordance.
- `requirements/10-migration.md` §10.5 — content-hub migration block rewritten as "not migrated"; §10.8 broadcast step + §10.10 risk row reworded to "out-of-band".
- `requirements/review-findings-v1.md` U3 — marked "Resolved by D15".
- `mvp/level-3.md` — re-titled "Master CRUD + Profile"; scope reduced accordingly; media-pipeline backlog linked from "Explicitly deferred".
- `mvp/level-1.md` / `mvp/level-2.md` / `mvp/level-2.5.md` — "Explicitly deferred" rows pointing at §3.8.1–§3.8.6 reshaped to call out Profile → L3 and D15's cancellation of the rest.
- `mvp/README.md` — ladder gains an **L2.4b** row linking to `level-2.4b.md` so the media-pipeline backlog is visible at a glance (D16).

---

## 2026-04-21 — L2.5 scoping (dashboard polish + §3.6.2 fold)

| # | Decision | Supersedes |
|---|---|---|
| D12 | **Consolidated dashboard (§3.6.2) is folded into the drill-down dashboard (§3.6.1), not built as a separate screen.** The live L2 dashboard already carries a KPI strip and attendance-trend chart; L2.5.3 extends both with the §3.6.2 metric pack (image %, video %, SoM MoM) and a "View More" per-village drill. One page, one URL, one edge-cache key. L3 scope shrinks to Master Creations + Secondary screens. | L3's "Consolidated dashboard" bullet (mvp/level-3.md prior to 2026-04-21); any earlier assumption that §3.6.2 ships as its own route. |
| D13 | **Image % and video % denominators are per scheduled attendance session in scope × date range.** A session counts toward the `image_pct` numerator if at least one image is tagged to the same event / village / day, and toward `video_pct` likewise. This reuses data the schema already has — no new "expected media count" field. §3.6.2's "uploads vs expected" phrasing is pinned to this definition. | §3.6.2's undefined "expected" baseline (ambiguous between per-day, per-session, per-village). |
| D14 | **The consolidated KPI pack renders at every drill level, not only cluster.** §3.6.2 originally framed the Consolidated view as cluster-scoped (a vendor-app holdover). In our single-tenant build, showing the same pack at India / Zone / State / Region / District / Cluster / Village gives one coherent dashboard and saves a second screen. The §3.6.2 cluster-specific "View More" button still renders at cluster level only, because village is already the leaf. | §3.6.2's implicit "cluster-only" scope. |

### Follow-on spec / mvp cleanups (same commit as D12–D14)

- `mvp/level-2.5.md` created (new file; sub-levels L2.5.1 / 2 / 3).
- `mvp/level-3.md` — Consolidated dashboard entry removed; title
  shortened to "Master CRUD + secondary screens"; acceptance list
  no longer references the consolidated dashboard; note inserted
  pointing at L2.5.3 + D12.
- `mvp/README.md` — ladder table gains an L2.5 row between L2 and L3.
- `mvp/level-2.md` — Status line notes L2.5 as the polish follow-on.
- `requirements/03-functional.md` §3.6.2 — rewritten to describe
  the fold: the section now defers mechanics to §3.6.1, records the
  D13 denominator, and affirms the D14 every-level scope. Section
  numbering is stable per CLAUDE.md; the header stays.

---

## 2026-04-20 — L2 kickoff

| # | Decision | Supersedes |
|---|---|---|
| D1 | Drop the `app_settings` table entirely. Retention timelines (student records, media) are handled **outside this system** — by ops, not by a Worker cron. Anything else `app_settings` was going to hold (session TTL, default language) moves to Worker env vars or code constants. | Review-findings U5 (Add `student_retention_years` to `app_settings`), L1-review H5 (create empty `app_settings` now). Both superseded. |
| D2 | Downgrade "Excel export" (§3.6.3, §5.10) to **CSV** for L2 and L3. True `.xlsx` is deferred to L5 (if it ever returns a net win over CSV). CSV is one function, zero dependencies, and every spreadsheet tool opens it. | — |
| D3 | **Defer R2 to the end of L2** (level 2.4). L2.0–L2.3 run against local D1 only; wrangler's `--local` R2 stands up the pipeline in L2.4. Production R2 binding is deferred until the first real deploy. | — |
| D4 | **No retention cron, no retention sweep worker, no `retained_until` pin.** Both the `media-retention` cron (§7.7) and the `retention-sweep` Worker (§11.3) are removed from the spec. Media deletion is a manual ops task for the lab; a deployment-time decision for production. | — |

### Follow-on spec cleanups (same commit as D1–D4)

- §4.3.8 (data model) — section removed; `audit_log` becomes §4.3.8.
- §7.7 (media retention) — replaced with a one-paragraph note that
  retention is out-of-system.
- §9.3 (compliance retention) — rewritten to describe the
  out-of-system boundary. Audit-log retention stays as an open item
  (ops question, not app config).
- §5.13 (`/api/settings`) — endpoint removed.
- §3.8.7 (Master Creations) — `retention settings` entry removed.
- §2.3 (capability matrix) — `Retention / app settings` row removed;
  Super Admin's only remaining exclusive capability is `Manage users`
  plus master CRUD.
- §2.1 (actors) — Super Admin description no longer mentions
  "retention config".
- §10 (migration) — `legacy_settings → app_settings` row removed
  from the master-data migration list; the vendor's config is
  retained only as reference for our env-var defaults.
- §11.3 (Workers) — `retention-sweep` Worker deleted. The three
  Workers are now `api` + `derive-media` + `migrator`.
- §11.7 (Queues) — `retention-sweep-media` queue deleted.
- §11.9 (Secrets) — `GRAFANA_CLOUD_PUSH_URL` surface list drops
  `retention-sweep`.
- §11.10 (CI/CD) — `/workers/retention-sweep` removed from the repo
  layout.
- §11.12 open items — the audit-log retention item (§9.6) stays
  because that's an ops policy, not an `app_settings` knob.

---

## 2026-04-20 — L2.3 PR #24 review

| # | Decision | Supersedes |
|---|---|---|
| D5 | **CSV exports carry no context line.** §3.6.3 says "CSV mirrors the on-screen table exactly". Inline `# India > Zone > …` comments are not RFC-4180 comments — Excel and pandas treat `#` as data, so the trail surfaces as a rogue one-cell row. Context lives in the **filename** instead: `<metric>_<level>[_<crumb>][_<from>_to_<to>].csv`. Two downloads from the same page with different scope or period therefore land as distinct files, not overwrites. | Earlier L2.3 draft that prepended `# trail` to each CSV. |
| D6 | **CSV cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` are prefixed with `'` before emit.** CWE-1236 (formula injection). Achievement descriptions are free-form VC input and the CSV is the only artefact users open in a spreadsheet. The single-quote prefix is interpreted as a text marker by Excel / Sheets / LibreOffice (not rendered in most views) and is safe literal data for programmatic CSV parsers. | — |

---

## 2026-04-20 — L2.4 kickoff (media pipeline scope)

| # | Decision | Supersedes |
|---|---|---|
| D7 | **L2.4 ships photo + voice-note + video under a single-PUT path with a 50 MiB raw cap across all three kinds.** Capture UX (camera / mic, preview, tag picker, AF village-pick) is identical across kinds; the differences live in the upload path, and we collapse them by capping size rather than splitting the feature. Presign returns one `upload_url`; client does one PUT; server commits after HEAD-verifies. | §7.2 per-kind caps (image 8 MiB, video 200 MiB, audio 16 MiB) — the wider caps return whenever multipart lands. |
| D8 | **Defer client-side video transcode (ffmpeg.wasm) to L2.4b or later.** §7.2's "mandatory transcode to 720p / ≤ 2 Mbps if source > 50 MiB" is unreachable without it, and the 50 MiB cap from D7 makes transcode moot for MVP content. The §7.8 acceptance target ("5-min 1080p over 3G in ≤ 5 min") is therefore **not** claimed in L2, even though the `/capture` page ships a video recorder — short lab-quality clips work, full-length 1080p recordings will refuse to upload with a cap-exceeded error until L2.4b lands. | — |
| D9 | **Defer R2 multipart (`upload_id` + `part_urls[]` + `POST /api/media/presign/parts`) to L2.4b or later.** The 50 MiB cap from D7 fits R2's single-PUT limit with room to spare; multipart returns together with transcode when we lift the cap. | §7.3 step 4 (> 10 MiB ⇒ multipart). |
| D10 | **Skip the `com.navsahyog.gps` container-metadata sidecar for video / audio.** Spec §7.2 already says "server trusts the body; the sidecar is a forensics backup" — the DB row + outbox body remain the source of truth. Writing MP4 `©xyz` / Matroska tags in-browser is a separate engineering task with no MVP payoff. EXIF GPS on images (native-format) is still preserved. | §7.2 sidecar requirement for video/audio. |
| D11 | **Defer the `media-derive` queue + thumbnails to L2.5 or L3.** No Queues binding is wired yet; list endpoints return the original object key as both `url` and `thumb_url` with a TODO. §7.5's "list views use `thumb_url`" still holds at the API contract level — the values just happen to point at the original until the derive consumer ships. | §7.4 derived renditions during L2. |

### L2.4b / follow-up backlog (tracked here, not in review-findings)

- Client video transcode via ffmpeg.wasm (§7.2, unblocks §7.8 acceptance).
- R2 multipart + resume-from-last-good-part (§7.3).
- MP4 / Matroska GPS sidecar writer (§7.2 forensics backup).
- `media-derive` Queues consumer + Cloudflare Images vs `wasm-vips` call (§7.4, §7.9 open item).

---

## How to use this file

- **Add a row at the top** (reverse-chronological) when a review
  meeting or working session produces a new decision.
- **Update the spec in the same commit.** If a decision touches §X
  and §Y, both sections change together with the `decisions.md`
  update.
- **Don't reopen.** If a decision needs to be revisited, add a new
  row that supersedes it explicitly, and re-edit the spec. The old
  row stays (with its date) for history.
