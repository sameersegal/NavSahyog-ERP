# Level 4 — Offline mode

**Status:** not started. Re-scoped from "3-workflow lab demo" to
"offline-as-platform" — see decisions.md D29–D32. Requires L3 landed.

## Goal

Build offline as a platform that supports most VC / Cluster
data-capture workflows in production and survives ongoing schema
and endpoint iteration. The original level treated offline as an
architecture demo against three frozen workflows; the field reality
is broader scope and continuous iteration after deploy. The platform
ships first; workflows opt in incrementally.

## Sub-levels

| Sub | Scope | Status |
|---|---|---|
| L4.0a | Foundation primitives — `X-App-Build` header, server compat middleware (initial wall-clock-based; replaced in L4.0c), client build-id injection, real network detection (HEAD probe, not `navigator.onLine`), sync-state taxonomy (green/yellow/red/update_required) chip in chrome, force-upgrade banner. **No outbox or IDB yet.** | in flight |
| L4.0b | Generic versioned outbox — IDB migration framework, ULID-keyed `outbox` store, opaque drain runner with backoff + 426 handling, dead-letter pathway, hard outbox cap, `/outbox` UI screen with retry/discard/manual sync, sync chip wired to queued/dead-letter counts. **No live workflows enqueue yet.** | in flight |
| L4.0c | Update discipline — deploy-grace fix (`MIN_SUPPORTED_BUILD` operator floor instead of wall-clock-today), `SERVER_BUILD_ID` stamped on every response, soft dismissible "Update available" banner when client observes a newer server build, plus a reference deploy script. **No service worker** — the soft signal travels on response headers, which is enough for data-offline workflows. | in flight |
| L4.0d | Additive-only contract harness — `regression-corpus/` directory + a vitest harness that walks it and replays every payload against the live worker, asserting 2xx. Empty corpus today (first L4.1 endpoint adds payloads). Also Outbox UI dead-letter polish: expandable support-bundle JSON + clipboard copy for support tickets. | in flight |
| L4.0e | **Deferred** — replay tool + cache integrity check. Both have "wait until something else lands" dependencies (real field users / real cache stores). See decisions.md D33. Not blocking L4.1. | deferred |
| L4.0 | Offline platform — versioned generic outbox, IDB migration framework, build-id discipline, sync-state taxonomy, additive-only contract harness. **No new offline workflows ship in this slice.** Functionally complete with L4.0a–d; L4.0e items deferred per D33. | in flight (L4.0a + L4.0b + L4.0c + L4.0d in review) |
| L4.1 | Onboard the §6.1 three workflows (attendance, achievements, media) onto the L4.0 platform. | not started |
| L4.2+ | Progressive opt-in per workflow as `requirements/offline-scope.md` grows. Each new offline-eligible workflow is its own small PR with a decision entry. | not started |

## Working principles

These hold across every L4 sub-level. They restate decisions D29–D32
in operational terms — see `requirements/offline-scope.md` and §6.0
for the spec wording.

1. **Online-only by default.** A workflow becomes offline-eligible
   only by landing a row in `offline-scope.md` with a D-numbered
   decision. Stops scope creep at design time, not in PR review.
2. **Additive-only contract on offline-eligible endpoints.** New
   nullable fields are fine; renames, removals, and tightened
   validation require a new endpoint version. CI regression corpus
   enforces this on every PR (L4.0 deliverable).
3. **N-7 compat window.** Clients ship same-day, max end-of-week
   (D31). Server adapters cover the last seven days of builds;
   outbox items older than that dead-letter. Force-upgrade screen
   blocks new queueing past the window.
4. **One mutation endpoint per workflow.** Each offline-eligible
   capture is a single `POST` carrying the full intent (e.g. the
   whole attendance session). No fragmentation into create-then-add
   sub-endpoints — that puts ordering and partial-success in the
   queue.
5. **No optimistic UI.** Queued items render with a "queued" chip
   and don't merge into list/detail views as if accepted. Eliminates
   reconciliation, rollback flicker, and "did this submit?"
   ambiguity.
6. **Scope-bound caching.** A VC's cache holds their one village
   and dependents — kilobytes. No global table replication.
7. **Replace-snapshot, not deltas.** Manifest sync returns the full
   per-user scope; no `since=…` protocol, no tombstones. Cheap at
   this scale; one less subsystem to keep correct.
8. **Foreground sync only.** Drain runs on app open + `online`
   event + manual trigger from the Upload screen. No Background
   Sync API — its race conditions cost more than the convenience.
9. **Server is the truth.** No CRDTs, no merge resolution, no
   draft state. Each mutation is independent and idempotent;
   conflicts are domain-modelled (attendance upsert by
   `(village, date, event)`, etc.) per §6.6.
10. **Hard outbox cap.** ~100 items / 50 MiB media. Past the cap,
    block new captures with a clear "you're past the offline limit,
    sync now" message. Bounded failure beats silent corruption.

## L4.0 — platform

In scope:

- **Generic versioned outbox.** Row shape extends §6.3 with
  `schema_version` and `build_id`. The drain runner replays
  opaquely — no per-endpoint branches in the runner. Adding an
  offline-eligible workflow is a route registration, not a
  drain-runner change.
- **IndexedDB migration framework.** `onupgradeneeded` per release
  with a registered migration list. Forward-only. On a genuinely
  breaking cache shape change, drop-and-resync next online window.
- **Service-worker upgrade discipline.** New build detection +
  user-facing "refresh to upgrade" banner. Blocks queueing past
  the N-7 window with a hard "Update required" screen.
- **Build-id propagation.** Every request from the client carries
  `X-App-Build` + the request's `schema_version`. Server can
  refuse-with-explain (HTTP 426) on builds past the compat window
  rather than silently 4xx-ing.
- **Additive-only CI regression corpus.** A folder of real payloads
  from each release; a CI job replays them against the current
  server (locally via Workers + D1). A failing payload is a
  contract violation that blocks merge.
- **Sync state taxonomy in the chrome.** Green / yellow / red
  indicator in the header (not just on the dedicated sync screen).
  Green: all synced. Yellow: queued, draining. Red: dead-letter,
  user action required.
- **Dead-letter UX.** Any rejected item surfaces a human-readable
  summary (not raw JSON), the rejection reason, and clear
  re-edit / discard actions. No silent drops.
- **Real network detection.** HEAD probe to a known endpoint with
  a 3s timeout, not `navigator.onLine` (which lies on captive
  portals).
- **Cache integrity check.** Once per online session, compare a
  checksum of cached scope to a server-computed value. Diverge →
  drop and resync. Cheap insurance against IDB corruption on
  low-memory Android.
- **Replay tool (internal).** A CLI / staging endpoint that takes
  an exported outbox dump from a problem user and replays it
  against staging. Builds itself; pays for itself the first time
  a VC's phone fails to sync in the field.

Out of scope (deliberately):

- Any new offline-eligible workflows. L4.0 is platform only;
  workflows ship in L4.1+.
- Background Sync API.
- Optimistic UI / draft state / merge resolution.
- Manifest delta protocol.

## L4.1 — onboard the §6.1 three workflows

The original level-4 plan, ported onto the L4.0 platform.

In scope:

- Attendance, achievements, media capture run through the generic
  versioned outbox.
- IndexedDB cache stores per §6.2 (`session`, `cache_villages`,
  `cache_schools`, `cache_students`, `cache_events`, `outbox`,
  `media_blobs`, `audit`), all scope-bound (one VC's authority,
  not global).
- Manifest sync as a full-snapshot replace (D32) — `GET
  /api/sync/manifest` returns the user's full scope; client wipes
  and reseeds the cache stores.
- Outbox UI (the `Upload Offline Data` screen from §3.7) wired to
  per-item retry, dead-letter actions, and the sync-state chip.

Acceptance (lab-verifiable):

1. Throttle to offline (DevTools → Offline). Mark attendance in
   two villages. Re-enable network. Outbox drains; server rows
   appear with client-supplied `captured_at` and server-stamped
   `received_at`.
2. Kill and reopen the app between queue and drain — outbox
   survives (IDB durability).
3. An item that fails 5 times shows the error banner and stays in
   the queue until manually retried or discarded.
4. A duplicate attendance submission for the same `(village, date,
   event)` replaces the prior list on the server (§3.3.3).
5. Cache stores stay within the §6.2 size budget (≤ 5 MiB combined
   for the cache_* stores) on a typical VC scope.
6. **Compat regression**: a payload corpus from the L4.0 platform
   release replays cleanly against the L4.1 server. Adding a
   nullable field to attendance (between L4.0 and L4.1) does not
   break the L4.0 corpus.

## L4.2+ — progressive opt-in

Each new offline-eligible workflow lands as its own slice, in this
order:

1. A row added to `requirements/offline-scope.md` flipping the
   workflow's status from `online-only` to `offline-eligible`,
   with rationale and owner.
2. A D-numbered decision in `decisions.md` capturing the trade-offs
   (cache shape, idempotency primary key, dead-letter semantics).
3. A small PR wiring the workflow's mutation endpoint and any
   newly-cached entities. The drain runner is untouched.
4. Payload corpus updated.

First L4.2 candidate, by current evidence: **Jal Vriddhi pond
capture** (§3.10). Currently `online-only` per D25, where the
agreement file size + criticality drove the choice. With the
versioned outbox and the dead-letter UX in place, the calculation
changes — re-evaluate at L4.2 kickoff.

## Watch-out

L4 ships on trivial auth (sessions from L1 are signed tokens with
long TTL). When L5 introduces real session revocation, the outbox
drain path needs re-testing: a queued mutation might carry an
expired or revoked session. Add this as an explicit L5 acceptance
item when L5 starts; don't try to pre-solve it here.

## Explicitly deferred

- Auth hardening (§3.1.2–§3.1.4) — L5.
- Compliance (§9) — L5.
- Background Sync API — out of scope per principle 8.
- Optimistic UI / draft state — out of scope per principle 5.
- iOS / Capacitor — `requirements/01-overview.md` §1.3 deferral
  still applies. Capacitor would widen the upgrade window past N-7
  (Play Store cadence), which would force a redesign of the compat
  surface; revisit only if a Play Store path is approved.

## Notes

- Idempotency keys: ULID generated client-side on enqueue; server
  stores them keyed by user + endpoint, 24h TTL. Duplicate request
  with the same key returns the prior response (§5.1).
- Lab-only means we can test the "clock skew" branch (§6.7) by
  manually adjusting the system clock before re-enabling network.
- The contract surface lives in `requirements/offline-scope.md` —
  treat it as the source of truth for "is this workflow offline?"
  and pair every change there with a decision entry.
