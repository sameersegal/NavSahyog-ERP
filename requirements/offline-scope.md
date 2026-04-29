[← Index](./README.md) · [§6 Offline & sync](./06-offline-and-sync.md) · [Decisions](./decisions.md)

---

# Offline scope — contract surface

This doc is the **authoritative list** of which workflows are offline
and which are not. It is the contract surface that the additive-only
rule binds to (decisions.md D30): every endpoint listed here as
`offline-eligible` or `offline-required` is frozen for breaking
changes; every endpoint listed `online-only` evolves freely.

If an endpoint isn't here, treat it as **`online-only` by default**.
Adding a workflow to this doc is a deliberate act, not the result
of someone wiring it through the outbox.

## Status values

| Status | Meaning | Contract |
|---|---|---|
| `online-only` | Workflow refuses to operate without connectivity. UI shows a banner and disables the action. | None. Endpoint shape evolves freely. Default for everything not listed. |
| `offline-eligible` | Workflow can be used offline; mutations queue in the outbox and drain on reconnect. Reads use the cached scope when available, fall back to a "no cached data" state when not. | **Additive-only contract** (decisions.md D30). New nullable fields OK; renames, removals, tightened validation are not. Tightening a constraint requires a new endpoint version. |
| `offline-required` | Workflow is expected to function offline as the primary use case. Same contract as `offline-eligible`, plus elevated cache priority — the relevant scope is preloaded on every online login and never evicted while a related outbox item is pending. | Same additive-only contract. |

The compat window for offline-eligible endpoints is **last 7 days
of builds** (decisions.md D31). A queued payload from a build
older than that dead-letters with a re-edit-or-discard prompt.

## Workflow inventory

The table below is grouped by section of `requirements/03-functional.md`.
Authority to flip a row's status sits with the named owner; changes
land via a decision entry (D-numbered) in `decisions.md`.

| § | Workflow | Status | Endpoints | Owner | Notes |
|---|---|---|---|---|---|
| §3.1 | Login / auth | `online-only` | `POST /api/auth/login`, `POST /api/auth/logout`, OTP family | Backend | Sessions revalidate online. Outbox drain re-prompts on session expiry (level-4.md watch-out). |
| §3.1.5 | Profile (read-only) | `online-only` | `GET /api/me` | Backend | Cache hit on the `session` store covers offline display. |
| §3.2.2 | Add child | `offline-eligible` | `POST /api/children` | Field workflows | D35: server-side create with a client ULID idempotency key. **Visibility-after-sync rule** — a child created offline appears in `cache_students` only after the drain succeeds and the next manifest pull lands; until then they do not appear in the achievement picker, the village children list, or any read screen. PATCH and `/graduate` remain `online-only`. |
| §3.3 | Mark attendance | `offline-required` | `POST /api/attendance/submit` | Field workflows | One mutation per session per §6.1. Idempotent on `(village, date, event)`. |
| §3.4 | Add achievement | `offline-required` | `POST /api/achievements` | Field workflows | SoM uniqueness enforced server-side; conflict surfaces in the dead-letter UI. |
| §3.5 | Capture media | `offline-required` | `POST /api/media/presign`, `POST /api/media/commit` | Field workflows | Two-step (presign + commit) is one logical workflow; outbox stores the intent and the runner orchestrates both. |
| §3.6 | Dashboards (drill-down + home) | `online-only` | `GET /api/dashboard/*` | Backend | Cached snapshot is **not** kept; offline shows a "data unavailable" state with a "last synced" timestamp. |
| §3.6.4 | Field-Dashboard Home | `online-only` | `GET /api/dashboard/home` | Backend | Same as above. The doer Capture FAB still works offline because Capture is `offline-required`. |
| §3.8.1 | Profile screen | `online-only` | `GET /api/me/profile` | Frontend | Read-only; trivially renderable from the cached `session` store. |
| §3.8.7 | Master Creations (villages, schools, events, qualifications, users) | `online-only` | `POST /api/villages`, `POST /api/schools`, `POST /api/events`, `POST /api/qualifications`, `POST /api/users` (and PATCH counterparts) | Backend | Master mutations are rare, Super-Admin-only, and reference checks (FK to scope) need server authority. Refusing offline is the correct posture. |
| §3.8.8 | Training manuals | `online-only` (read), `online-only` (write) | `GET /api/training-manuals`, `POST /api/training-manuals` | Backend | Catalogue is small but online-only — manuals open in a new tab and need network anyway. |
| §3.10 | Jal Vriddhi pond + agreement | `online-only` *(revisit at L4.2)* | `POST /api/ponds`, `POST /api/ponds/agreements/*` | Field workflows | D25 chose online-only because the agreement file is the high-stakes artefact in the workflow. Re-evaluate once L4.0 platform lands — the workflow itself is field VC capture and is a natural offline candidate. |
| §6.4 | Manifest sync | n/a (infra) | `GET /api/sync/manifest` | Backend | Replace-snapshot per §6.0; not a user-facing workflow. |

## Scope-bound caching

Reads served from cache are **scoped to the user's authority**, not
the global table:

- A VC's cache holds their one village, its schools, its students,
  the event picklist. Roughly kilobytes.
- A Cluster's cache holds the cluster's villages and their
  dependents. Still small.
- District+ roles inherit the `online-only` posture for dashboards,
  so their cache stays minimal — just enough to render Profile.

This cuts both blast radius (a stolen device exposes one VC's
scope, not the country) and compat surface (the cache shape doesn't
need to scale with the master tables).

## Process for changing this doc

1. **Adding a workflow as `offline-eligible` or `offline-required`**
   requires a decision entry in `decisions.md`, an additive-only
   contract acknowledged in the implementation PR, and a row in
   `mvp/level-4.md`'s L4.2+ progressive-opt-in section.
2. **Flipping a workflow back to `online-only`** is a breaking
   change — deployed clients have queued items in that endpoint's
   shape. Requires a deprecation window: stop accepting new
   client-side queueing, drain existing items under the old
   contract, then remove. Schedule this across two L4.x releases.
3. **Tightening validation** on an offline-eligible endpoint is
   the same kind of breaking change — see the additive-only
   contract in decisions.md D30 for the explicit rules.

## Open items

- [ ] Re-evaluate Jal Vriddhi pond at L4.2 (per the row above).
      The agreement file question is the pivot — if we're willing
      to queue PDF uploads through the same media path, the
      workflow becomes offline-eligible.
- [x] **Resolved (D35)** — offline student creation is `offline-eligible`
      with a *visibility-after-sync* contract: a child created
      offline does not appear in any read screen until the drain
      succeeds and the next manifest pull lands. This eliminates
      placeholder UUIDs and FK-rewrite-on-drain entirely; the cost
      is that a VC who creates a new child cannot record an
      achievement for them in the same offline session. See `§3.2.2`
      row above and `decisions.md` D35.
