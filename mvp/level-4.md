# Level 4 — Offline mode

**Status:** not started. Requires L3 landed.

## Goal

Prove the sync architecture in lab conditions. Not driven by a
current field-connectivity need; we build it so the architecture
is validated before real-data work begins in L5.

## In scope

- **Offline scope (§3.7, §6.1).** The three workflows: attendance,
  achievements, media capture. Everything else stays online-only
  with banner + disabled menu items.
- **IndexedDB layout (§6.2).** `session`, `cache_villages`,
  `cache_schools`, `cache_students`, `cache_events`, `outbox`,
  `media_blobs`, `audit`. Size budgets honoured.
- **Manifest sync (§6.4).** `GET /api/sync/manifest?since=…`
  returns deltas for cached entities. Seeded on first login,
  refreshed on every subsequent online login.
- **Outbox (§6.3).** Mutations queued with idempotency keys.
  Retry with backoff. Per-item status (`pending` / `uploading` /
  `done` / `error`). UI: outbox badge on home, "Upload Offline
  Data" screen with per-item retry.
- **Media queue (§7, §6.1).** Captured media stored in
  `media_blobs`, uploaded via the same R2 presign + multipart path
  as online capture, just deferred.

## Explicitly deferred

- Auth hardening (§3.1.2–§3.1.4) — L5.
- Compliance (§9) — L5.

## Acceptance (lab-verifiable)

1. Throttle to offline (DevTools → Offline). Mark attendance in
   two villages. Re-enable network. Outbox drains; server rows
   appear with client-supplied `captured_at` and server-stamped
   `received_at`.
2. Kill and reopen the app between queue and drain — outbox
   survives.
3. An item that fails 5 times shows the error banner and stays in
   the queue until manually retried or deleted.
4. A duplicate attendance submission for the same (village, date,
   event) replaces the prior list on the server (§3.3.3).
5. Cache `cache_students` does not exceed 5 MiB combined with the
   other cache stores (§6.2).

## Notes

- Idempotency keys: UUID v4 generated client-side on enqueue.
  Server stores them in a small KV set keyed by user + endpoint,
  24h TTL. Duplicate request with the same key returns the prior
  response.
- Lab-only means we can test the "clock skew" branch (§3.7) by
  manually adjusting the system clock before re-enabling network.

## Watch-out

L4 ships on trivial auth (sessions from L1 are signed tokens with
long TTL). When L5 introduces real session revocation, the outbox
drain path needs re-testing: a queued mutation might carry an
expired or revoked session. Add this as a explicit L5 acceptance
item when L5 starts, don't try to pre-solve it here.
