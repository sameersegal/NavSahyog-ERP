# dashboard

Reads that aggregate data from the program contexts: drill-down,
home strip, KPIs, streaks.

- Routes: dashboard, insights, streaks
- Spec: §3.6 (Dashboards), §3.6.4 (home strip / streaks)
- Cross-cut: §2.3 *scope-breadth table* (which the matrix can't
  capture)

## Invariants

- **Always online-only** (offline-scope.md §3.6 + §3.6.4). The
  cached snapshot is intentionally **not** kept. Offline shows a
  "data unavailable" state with a "last synced" timestamp,
  not a stale render.
- **Computed, not precomputed.** Every endpoint runs the
  aggregation at request time. Back-of-envelope rationale lives in
  the [`insights.ts`](../../../apps/api/src/routes/insights.ts)
  file header. If a route ever becomes hot, KV-cache on a
  short TTL — don't introduce a precompute table.
- **Scope-bounded by `villageIdsInScope()`.** The capability gate
  (`dashboard.read`) lets every authenticated role through; the
  scope function decides what each one *sees*. The
  scope-breadth table in §2.3 is the canonical reference for
  per-role breadth — it can't live in the matrix because it's
  enforced at runtime, not by `requireCap`.

## Streaks lifecycle gotcha

The "logging streak" is the count of consecutive IST dates,
ending on **today or yesterday**, on which the user's scope ran
at least one attendance session.

> The streak may end on yesterday rather than today so that a VC
> checking in at 10 AM before logging the day's session doesn't
> see "streak: 0" — they see their previous run, and the app
> doesn't punish them for not having logged *yet*.

(See [`streaks.ts`](../../../apps/api/src/routes/streaks.ts) header.)

This is the kind of UX-shaped invariant that's easy to "fix" into
a stricter today-only definition during refactor and break the
field UX silently.

## Cross-context coupling

- **Reads from every program + master context.** A schema change
  to attendance, achievements, ponds, students, or villages can
  ripple into a dashboard query. The §10 field-mapping table is
  the canonical place to track those.
- **CSV export** is a `dashboard.read` capability surface but
  the row-allowed list (every role except VC) lives in the §2.3
  scope-breadth table.
