# beneficiaries

Children / students — the central entity the program workflows
operate on.

- Routes: [`apps/api/src/routes/children.ts`](../../../apps/api/src/routes/children.ts)
- Spec: §3.2 (Children / student master)
- Decisions: D35 (offline-eligible POST + visibility-after-sync)

## Visibility-after-sync (D35)

The single most important invariant in this context.

A child created offline does **not** appear in any read screen
until two things happen:

1. The outbox drain succeeds and the server confirms the create.
2. The next manifest pull lands and reseeds `cache_students`.

Until then they are absent from:

- the village children list,
- the achievement picker,
- the attendance roster,
- any drill-down that filters by student.

This is the "no optimistic UI" working-principle (D32) applied
consistently — server is the truth, the cache reflects the
server, the outbox is queued intent and nothing more.

**Field consequence:** a VC who creates a new child cannot record
an achievement for them in the same offline session. They must
wait for the next online window.

## Mixed-mode handlers in one file

Even though `children.ts` is tagged `offline: { write: 'eligible' }`
file-wide, the offline status differs by handler:

| Handler | Offline mode |
|---|---|
| `POST /api/children` | offline-eligible (D35) |
| `PATCH /api/children/:id` | online-only |
| `POST /api/children/:id/graduate` | online-only |

The matrix table in
[`../../generated/endpoints.md`](../../generated/endpoints.md)
shows `Idempotent: yes` only on the offline POST, which is the
proxy for "this is the offline-enqueueable handler".

## Lifecycle gotchas

- **Graduation is a one-way state transition.** `graduated_at` +
  `graduation_reason` get set together; there is no un-graduate.
  All read screens filter `graduated_at IS NULL` for active
  rosters; graduated rows persist for audit.
- **Idempotency key is a client ULID.** The outbox runner
  generates it before queueing; replays of the same key return the
  prior 201 verbatim.
