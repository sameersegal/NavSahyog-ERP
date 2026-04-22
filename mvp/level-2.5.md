# Level 2.5 — Dashboard polish + consolidated fold

**Status:** landed. L2.5.1 + L2.5.2 + L2.5.3 all shipped in PR #31
(bundled per operator direction; stacked-PR rule waived for this one).

## Goal

Make the drill-down dashboard (§3.6.1) a first-class mobile
experience on an iPhone 13 mini (375×812 CSS px), cut the taps
required to reach a village from seven to two, and fold the
Consolidated dashboard (§3.6.2) into the same screen instead of
building it as a separate surface in L3.

This closes L3.1 early. L3 is reduced to Master Creations +
Secondary screens.

## Why L2.5 exists

L2.0–L2.4 shipped the write loop and the drill-down dashboard.
Two gaps surfaced when the stakeholder used the live build on an
iPhone 13 mini:

1. **Layout breaks below 640 px.** The filter bar's two
   `input[type=date]` controls plus a "–" separator overflow the
   viewport (`apps/web/src/pages/Dashboard.tsx:198–213`); touch
   targets are 36–40 px (WCAG wants ≥ 44 px); the table relies on
   `overflow-x-auto` (line 536) instead of a mobile card layout.
2. **Scope navigation is slow.** Reaching a specific village
   from the India root takes seven clicks. Scope lives in React
   `useState` only (line 83), so a refresh or tab switch drops
   the user back to their default scope.

The existing Dashboard already has the KPI strip and attendance
trend chart the §3.6.2 "Consolidated" view calls for. Building
§3.6.2 as a separate screen in L3 would duplicate wiring. L2.5.3
extends the existing strip with the §3.6.2 metric pack
(image %, video %, SoM MoM) and the §3.6.2 "View More" drill —
same page, same components.

## Sub-level ordering

All three sub-levels shipped together in PR #31 at operator request
(instead of the originally-planned sequential merges). Each commit
on the branch maps 1:1 to a sub-level so the stacked fold is still
reviewable section-by-section.

| Sub | Theme | Status |
|---|---|---|
| **L2.5.1** | URL-backed scope + date state, responsive pass baseline | ✅ |
| **L2.5.2** | Scope quick-pick search, sibling-jump breadcrumbs, table → card view below `sm`, touch targets ≥ 44 px | ✅ |
| **L2.5.3** | §3.6.2 fold — attendance % / avg children / image % / video % / SoM MoM tiles, 6-month trend chart, "View More" per-village drill, scope preserved on metric switch | ✅ |

## L2.5.1 — URL + responsive baseline

### In scope
- **Scope + date persistence.** Store `{metric, level, id, from,
  to}` in query params (`useSearchParams`). Restore on mount;
  deep links share directly.
- **Date controls below `sm`.**
  - Stack the two date inputs vertically.
  - Add an explicit **Single day** toggle (collapses to one
    input, sets `from = to`, mirrors the onboarding doc's
    "single day or range" framing in §3.6.2).
- **Typography + spacing at 375 px.** Tighten KPI label / value
  sizes, verify header does not crowd the streak chip.
- **No horizontal scroll at 375 px** on any region except the
  data table (the table becomes a card grid in L2.5.2).

### Out of scope
- Table card view (L2.5.2).
- Scope quick-pick (L2.5.2).
- New metrics or API surface (L2.5.3).

### Acceptance
1. Refresh and tab switch preserve current scope, metric, and
   date range.
2. A direct link to `?metric=attendance&level=cluster&id=42&from=2026-04-01&to=2026-04-21`
   opens the dashboard at that position for any user whose scope
   permits it; returns a scope-error banner otherwise (not a
   silent reset).
3. At 375 px × 812 px, no page region overflows the viewport
   horizontally except the data table.
4. CI viewport screenshot (375×812) committed under
   `mvp/screenshots/l2.5/` and embedded in the PR body.

## L2.5.2 — Fast scope navigation + mobile-first table

### In scope
- **Quick-pick search.** A typeahead in the filter bar over
  villages and clusters within the user's scope. Uses the
  existing `/api/geo/*` endpoints. Selecting a result sets
  `pos` + breadcrumb atomically. Global user reaches a specific
  village in ≤ 2 interactions (open search, pick result).
- **Sibling-jump breadcrumbs.** Each crumb grows a `⌄` chevron
  that opens a sibling picker (Zone A → Zone B without walking
  back to India). List items are scope-filtered server-side.
- **Table card view below `sm`.** `DrillDownTable` renders as a
  stack of cards — each card is one row, label-value pairs
  inside. Above `sm`, stays as the current table. CSV export
  unchanged (server-rendered, one endpoint).
- **Touch targets ≥ 44 px.** Breadcrumb buttons, preset
  buttons, CSV download, date inputs, quick-pick results.

### Out of scope
- Any new metric data (L2.5.3).
- Introducing a `xs` breakpoint in Tailwind — not needed if the
  layout is correct at 320 px with the default `sm: 640 px`.

### Acceptance
1. A global user finds village "Devalapura" from the India root
   in two interactions; scope and breadcrumb both update.
2. A District admin's quick-pick only returns villages within
   their district; server returns `403` on an out-of-scope ID
   submitted by URL.
3. At 375 px, the village-level Children table renders as
   stacked cards; at 640 px+, as a table. Same data either way.
4. Every interactive control on the dashboard is ≥ 44 px on the
   smallest tested viewport (automated check in CI or a Chromatic-
   style visual test — TBD; at minimum a manual sign-off
   checklist in the PR).

## L2.5.3 — Fold §3.6.2 Consolidated into Dashboard

### In scope
- **Extend the KPI strip.** At every drill level, the strip
  shows:
  - attendance % (sessions marked / expected sessions in range)
  - average children per session
  - image % (sessions with at least one image / expected sessions)
  - video % (sessions with at least one video / expected sessions)
  - SoM current month vs previous month — current count with a
    delta chip (`+3` / `-2` / `±0`)
- **Bar chart.** Existing `AttendanceTrendInline` extends from
  3 months to 6 months at cluster level and above; stays 3
  months at village / district.
- **"View More" button** beneath the strip at cluster level
  drills to per-village rows. Reuses existing
  `DrillDownTable` — no new table component.
- **Server contract.** Extend `/api/dashboard/drilldown` with
  `consolidated=1`; response adds `kpis.{attendance_pct,
  avg_children, image_pct, video_pct, som_current, som_delta}`
  and `chart.bars[]`. One endpoint, one edge-cache key.
- **Expected-session denominator** for attendance %, image %,
  video %: **per scheduled attendance session** in the scope ×
  date range. A session counts toward the numerator if it has
  an attendance row (for `attendance_pct`), at least one image
  tagged to the same event/village/day (for `image_pct`), or at
  least one video (for `video_pct`). See decisions.md D13.

### Out of scope
- Consolidated-only screen under a separate route — explicitly
  avoided (decisions.md D12).
- Donor-engagement dashboard (§3.9) — separate surface, L3+.

### Acceptance
1. At the India root, the KPI strip shows aggregates across all
   clusters for the selected date range; matches the sum of the
   per-cluster tiles opened one level down (within rounding for
   percentages).
2. At the cluster level, "View More" drills to a per-village
   table with the same KPIs per row.
3. Changing the date range re-fetches the strip and the chart
   in a single request (no double round-trip).
4. Image % / video % use the denominator from decisions.md D13;
   definition is stated in the footer of the KPI strip for
   operator clarity.
5. Switching metric from "Children" to "Attendance" while at
   a cluster position preserves the position — the URL updates
   `metric=` but keeps `level=cluster&id=…`.

## Spec / doc updates landing with L2.5

All in the L2.5.1 PR, since they describe the whole L2.5 arc:

- `mvp/level-2.5.md` — this file (new).
- `mvp/level-3.md` — Consolidated dashboard entry deleted;
  pointer to L2.5.3 inserted in Notes. L3 rescoped to Master
  Creations + Secondary screens.
- `mvp/README.md` ladder table — add the L2.5 row.
- `mvp/level-2.md` — Status line notes L2.5 as the follow-on
  polish pass.
- `requirements/decisions.md` — new dated block with D12
  (Consolidated folded into §3.6.1), D13 (image % / video %
  denominator), D14 (Consolidated pack at every level, not only
  cluster).
- `requirements/03-functional.md` §3.6.2 — rewritten to defer
  the mechanics to §3.6.1, record the denominator, and mark
  the section as folded (numbering stable per CLAUDE.md — the
  header stays).

## Explicitly deferred

- Offline (§3.7, §6) — L4.
- Auth hardening, compliance (§9) — L5.
- Master Creations (§3.8.7) — L3.
- Profile (§3.8.1) — L3.
- *(§3.8.2–§3.8.6 cancelled in decisions.md D15.)*
- Consolidated-as-separate-route — cancelled (decisions.md D12).

## Notes

- iPhone 13 mini (375×812) is the baseline; at 320 px the
  layout should still not overflow. Tailwind defaults stay
  (`sm: 640 px`), no custom `xs` breakpoint.
- Keep `max-w-5xl` container at the shell level
  (`apps/web/src/pages/Shell.tsx:68`). L2.5 is about what
  happens inside that container.
- Screenshots for the PR body live under
  `mvp/screenshots/l2.5/` per CLAUDE.md's UI-PR convention.
