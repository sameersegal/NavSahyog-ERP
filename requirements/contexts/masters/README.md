# masters

Reference data that other contexts depend on: geography, villages,
schools, events, qualifications, training manuals.

- Routes: geo, villages, schools, events, qualifications, training_manuals
  (under [`apps/api/src/routes/`](../../../apps/api/src/routes/))
- Spec: §3.8.7 (Master Creations), §3.8.8 (training manuals),
  §3.6.1 (geo navigation)
- Decisions: D22 (super-admin write caps), D23 (event.kind
  immutability)

## Invariants

- **All master writes are super-admin-only.** Writes are
  online-only by design (offline-scope.md §3.8.7) — FK reference
  checks need server authority, and master mutations are rare.
- **`event.kind` is immutable once referenced** (D23).
  PATCH `/api/events/:id` returns 409 with `kind_locked: 1` once
  any media or attendance row points at the event. Name and
  description stay editable.
- **Reads are wider than writes**, but vary per master:
  - Villages, schools, events: read by every authenticated role.
  - Qualifications, training manuals (write), users (write):
    list endpoints are gated on the *write* cap because no
    non-admin consumer exists yet (D22). Adding a non-admin
    consumer means splitting `*.read` from `*.write`.

## Cross-context coupling

- **Manifest cache covers villages and events; not the rest.**
  See [`../../../apps/api/src/routes/sync.ts`](../../../apps/api/src/routes/sync.ts)
  for the snapshot shape. Schools, qualifications, training
  manuals are NOT in the manifest — adding them is additive (D30)
  but requires picking a scope rule (e.g. schools by village).
- **Geo `/search` and `/siblings` reuse `villageIdsInScope()`** so
  responses are pre-filtered. A District admin's `/geo/search`
  cannot leak village names from another district.
- **Event picker pulls from the manifest cache offline.** The
  AttendanceForm + AchievementForm both depend on this — if events
  ever leave the manifest, those forms break for offline-required
  workflows (attendance §3.3, achievements §3.4).
