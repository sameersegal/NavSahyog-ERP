[← §5 API surface](./05-api-surface.md) · [Index](./README.md) · [§7 Media →](./07-media.md)

---

## 6. Offline & sync

The vendor app mirrors every write into a parallel `*Offline` table
in SQLite, then bulk-uploads. The bespoke app replaces that with a
**single outbox queue in IndexedDB**, drained through the sync
endpoints (§5.14). The schema never has twin tables — offline state
is purely a client concern.

### 6.0 Offline contract (L4 amendment)

The original §6 was drafted for a 3-workflow lab demo. Field reality
needs offline to be a platform that survives ongoing iteration —
most VC / Cluster data-capture workflows will be offline-eligible,
new workflows will land regularly, and queued mutations from
older clients must keep draining cleanly. Decisions D29–D32 reframe
§6 around four rules:

1. **`offline-scope.md` is the authoritative scope doc.** Anything
   listed there as `offline-eligible` or `offline-required` is
   bound by the additive-only contract below; everything else is
   `online-only` and free to evolve. New workflows opt in via a
   D-numbered decision, never by accident.
2. **Additive-only contract on offline-eligible endpoints.** New
   nullable fields are fine; renames, removals, and tightened
   validation require a new endpoint version. A CI regression
   corpus replays real payloads from each release against the
   current server — a failing payload means the contract was
   violated.
3. **N-7 client compat window.** Clients are expected to upgrade
   same-day, with end-of-week as the hard ceiling (decisions.md
   D31). Server adapters for offline-eligible endpoints cover
   the last seven days of builds; outbox items older than that
   dead-letter on drain. A "Update required" screen blocks new
   queueing past the window.
4. **Generic, versioned outbox.** Outbox rows carry
   `{endpoint, body, schema_version, build_id, idempotency_key}`
   and replay opaquely. Adding an offline-eligible workflow is a
   route registration, not an outbox-processor change.

The detailed sub-sections below describe the original 3-workflow
implementation, which lands as L4.1. **§6.4 (manifest deltas) and
parts of §6.9 are superseded**: under D32 the manifest endpoint
returns a full per-user scope snapshot, not a `since=…` delta —
per-user scopes are kilobyte-sized and the delta protocol's
complexity buys nothing at that scale. Other sub-sections (§6.2
storage layout, §6.3 row shape, §6.5 runner, §6.6 conflict
resolution, §6.7 clock skew, §6.8 cache security) carry forward.

### 6.1 Scope (what works offline)

Per §3.7, only three workflows run offline:

- Mark attendance (`POST /api/attendance`)
- Add achievement (`POST /api/achievements`)
- Capture image / video / voice note (media upload — §7)

Everything else (login, dashboards, master edits, graduation)
requires online mode. Offline mode shows a banner and disables
those menu items.

Reads while offline are served from a **local cache** of the data
needed by these three workflows:

- Villages, schools, students (active only) in the user's scope.
- Events and activities (full picklists).
- The user's profile and role.

Cache is seeded on first online login and refreshed by
`/api/sync/manifest?since=…` on every subsequent online login.

### 6.2 Client storage layout (IndexedDB)

One IndexedDB database `navsahyog` with these object stores:

| Store | Key | Purpose |
|---|---|---|
| `session` | `'current'` | Current user profile, scope, language, `last_manifest_at`. |
| `cache_villages` | `uuid` | Scoped villages. |
| `cache_schools` | `uuid` | |
| `cache_students` | `uuid` | Active students (non-graduated) for scope. |
| `cache_events` | `uuid` | Events + activities (merged, distinguished by `kind`). |
| `outbox` | `idempotency_key` | Pending mutations. |
| `media_blobs` | `idempotency_key` | Binary payloads for queued media (separate store so outbox rows stay small). |
| `audit` | auto | Local ring buffer of last 500 sync events for debugging (capped). |

Size budget: cache stores target ≤ 5 MiB combined; media_blobs
capped at 200 MiB with an LRU eviction that refuses *new* captures
above the cap and surfaces an error banner (never silently drops).

Eviction never touches items in `outbox` until they're successfully
delivered.

### 6.3 Outbox row shape

```jsonc
{
  "idempotency_key": "01HXX…",       // ULID, generated client-side
  "created_at": 1713500000,           // epoch seconds
  "method": "POST",
  "path": "/api/attendance",
  "body": { /* the request body */ },
  "media_ref": "01HYY…",              // optional FK to media_blobs
  "attempts": 0,
  "last_error": null,
  "status": "pending"                 // pending | in_flight | done | failed
}
```

- **`idempotency_key`** is a ULID so rows sort by creation time
  naturally and it doubles as the `Idempotency-Key` header for the
  Worker (§5.1). The server dedupes by this key for 24 hours.
- **`body` never references server IDs** for records that were
  created offline — it references *other* `idempotency_key` values
  (e.g. an achievement queued for a child added while offline
  references the pending child's key). The sync runner resolves
  those to canonical UUIDs as it drains the queue.

### 6.4 Queueing rules

1. **All three offline-allowed write workflows enqueue unconditionally.**
   Online state is irrelevant at write time; the sync runner
   decides when to drain. This keeps behaviour identical online
   and offline — no separate code path.
2. **Each mutation is a single outbox row.** Attendance with N
   marks is *one* row that hits `POST /api/attendance` with the
   full marks array. (Matches §5.9's transactional semantics.)
3. **Media capture enqueues two things:**
   a. A `media_blobs` entry with the raw file.
   b. An `outbox` row with `method: "POST"`, `path: "/api/media"`,
      `body` containing the metadata, and `media_ref` pointing at
      the blob. The runner handles the R2 presign + PUT before
      submitting the metadata commit (§7.3).
4. **Duplicates are the client's problem.** If a user taps submit
   twice, the UI layer rejects the second tap (disabled button
   until outbox accepts); the outbox itself never enqueues two
   rows for the same logical action.

### 6.5 Sync runner

A Service Worker owns the runner. It runs when any of the
following fires:

- App start (if online).
- `online` window event.
- Periodic Background Sync (`navigator.serviceWorker.sync`,
  every 15 min when permitted).
- Manual trigger from the **Upload Offline Data** screen (§3.7).

Algorithm (single-threaded per device):

```text
while (outbox.has(pending or failed_with_retry_budget)):
    row = outbox.oldest_by_created_at()
    mark row.in_flight
    resolve placeholder refs in row.body
    if row.media_ref:
        if not uploaded_to_r2(row.media_ref):
            presign, PUT blob to R2
            mark blob uploaded
    response = fetch(row.method, row.path, row.body,
                     headers={Idempotency-Key: row.key})
    if response.ok:
        store canonical uuid(s) in a local ref-map
        mark row.done
        delete blob if any
    elif response.status in retryable():
        row.attempts++
        row.last_error = summary
        if row.attempts >= 5: mark row.failed
        else: mark row.pending with backoff(2**attempts seconds)
    else:
        mark row.failed with server error
```

Backoff schedule: 1s, 5s, 30s, 2m, 10m. Cap at 5 attempts, then
**require explicit user retry** (banner + per-item retry button in
§3.7's outbox screen).

### 6.6 Conflict resolution

- **Attendance** is idempotent by `(village, date, event)` per §5.9.
  A later offline submission for the same key *replaces* the
  earlier one; the server stamps `updated_at/by` and the client's
  outbox just records success.
- **Achievements** use the per-student partial unique index
  (§4.3.6, "one SoM per student per month"). A duplicate SoM
  submission returns 409; the runner surfaces it as a per-item
  error in §3.7's screen and offers **"overwrite server"** (which
  re-submits with a `force=true` flag — Super-Admin-only) or
  **"discard local"**.
- **Media** is never a conflict — each capture is a new object
  with a fresh UUID.
- **Student creation offline** is `offline-eligible` (decisions.md
  D35) under the **visibility-after-sync** rule: the outbox row
  carries the create payload + a client ULID idempotency key; the
  server assigns the canonical `student.id` on drain. Until the
  drain succeeds and the next manifest pull lands, the new child
  does **not** appear in any read screen — not in `cache_students`,
  not in the village children list, not in the achievement picker.
  This is the working-principle-5 ("no optimistic UI") posture: it
  eliminates placeholder UUIDs and the FK-rewrite-on-drain path
  entirely. If the server rejects on validation (e.g. duplicate
  name + DOB + village + parent phone), the item dead-letters and
  the user resolves it from the outbox screen.

### 6.7 Clock skew

- The client stamps **`captured_at`** in outbox rows and media.
- The server stamps **`received_at`** on commit.
- Dashboards and exports use `captured_at` by default and
  `received_at` as a tie-breaker.
- If `captured_at` is more than 7 days in the future relative to
  the server clock, the commit is rejected as `validation` — the
  client resolves by prompting the user to fix the device clock.

### 6.8 Security of offline cache

- `cache_*` stores are plain (no sensitive PII beyond what the
  user already sees in-app).
- **`outbox` and `media_blobs`** are encrypted at rest using a
  device-bound key:
  - Key derived via `crypto.subtle.deriveKey` from a per-device
    secret (first generated at install time, stored in
    `IndexedDB[session].device_secret`).
  - AES-GCM per row; the blob store stores a per-blob IV next to
    the ciphertext.
  - Password is *not* used as key material (would lock the user
    out of queued work on password change).
- On logout, all stores are wiped.
- On forced password change (§3.1.2), only the `session` store is
  cleared; the outbox is preserved so queued work survives the
  reset.

### 6.9 Manifest pull

**D32 amendment** — the original delta protocol (`?since=` +
tombstones) is replaced by a **full-snapshot replace** scoped to
the user's authority. The client wipes its `cache_*` stores and
reseeds from the response. Per-user scopes are kilobytes (one
village, dozens of students), so the delta protocol's complexity
(timestamps, tombstones, ordering, fence tokens) buys nothing.

`GET /api/sync/manifest` returns:

```jsonc
{
  "generated_at": 1713500000,        // server epoch seconds
  "scope": {
    "level": "village",              // user's authoritative scope
    "id": 1,
    "village_ids": [1]               // expanded scope for sanity checks
  },
  "villages":  [ /* ManifestVillage[] */ ],
  "students":  [ /* ManifestStudent[] — active only */ ],
  "events":    [ /* ManifestEvent[] — global picklist, L4.1c */ ]
  // schools (for offline child create) ride with the L4.1b
  // implementation. Adding nullable fields or new arrays is
  // additive-only (D30) and doesn't break older clients.
}
```

L4.1a ships villages + students. The contract is **additive-only**
(D30) — future slices may extend the response but never rename or
remove. Triggers (client side):

- App-start when the auth resume succeeds.
- The `online` window event firing.
- After a successful drain that reached `done` (so the cache picks
  up server-side state the queued mutations may have changed).

The client's read cache (§6.2) — `cache_villages` and
`cache_students` today, more later — is the offline source for
the AchievementForm picker and other workflows. The drain runner
does not touch these stores; only the manifest pull does.

`session.last_manifest_at` lives on the IDB `meta` store, keyed
`last_synced_at`. Used for diagnostics, not for delta calculation.

### 6.10 Capacity & performance targets

- **Offline dwell**: 7 days on-device without sync, assuming
  typical usage (1 attendance + ~5 captures + 1 achievement per
  day per VC) fits comfortably in the 200 MiB media cap.
- **Drain time** on a healthy 3G link: one day of backlog (say 6
  items, ~50 MiB of video) drains in ≤ 3 minutes end-to-end.
- **Initial seed**: manifest response for a typical cluster (≤ 500
  students, ≤ 30 villages) is ≤ 500 KiB gzipped.
- **Sync runner overhead**: ≤ 1 % battery per hour when idle
  (runner only wakes on the triggers in §6.5).

### 6.11 Observability

Every sync run writes a compact record to the local `audit` store
and, when online, POSTs a batched `sync.report` event to
`/api/audit-log` (as an `internal` action, throttled to 1 per
hour). Fields: items drained, items failed, bytes uploaded, total
wall time, oldest pending item age.

### 6.12 Acceptance criteria (cross-section)

- A VC with no connectivity for 72 h can take daily attendance,
  add achievements, and capture media, then on reconnect drain
  the queue with zero data loss.
- Closing the app or rebooting the device does not lose queued
  items or in-flight uploads.
- The same attendance session submitted offline then again online
  results in **one** server-side record, not two.
- An SoM achievement queued offline for a student who is later
  graduated (online) still applies, provided the achievement
  date is ≤ graduation date.
- A second device logged in as the same user sees queued items
  from the first device only after they sync; the outbox is
  device-local.

### 6.13 Open items

- [ ] Decide whether offline student-creation is permitted (§6.6
      assumes yes). Field practice may prefer forcing online for
      child registration to validate Aadhaar-free parent data in
      real time.
- [ ] Pick manifest granularity: full-scope vs per-resource
      (also flagged in §5.17).
- [ ] Confirm device-bound key storage is acceptable for
      NSNOP/legal — alternative is key in password-derived form,
      which loses data on password reset.

