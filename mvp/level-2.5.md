# Level 2.5 — Dashboard polish + consolidated fold

**Status: landed.** L2.5.1 + L2.5.2 + L2.5.3 all shipped in PR #31
(bundled per operator direction; stacked-PR rule waived).

## What L2.5 proved

Drill-down dashboard (§3.6.1) is a first-class mobile experience on
an iPhone 13 mini (375×812 CSS px). Reaching a village from India
root takes two taps instead of seven. The Consolidated dashboard
(§3.6.2) folds into the same screen instead of becoming a separate
surface in L3 — closes L3.1 early.

## What shipped (per sub-level)

| Sub | Theme |
|---|---|
| L2.5.1 | URL-backed scope + date state, responsive baseline |
| L2.5.2 | Scope quick-pick, sibling-jump breadcrumbs, table → card view below `sm`, touch targets ≥ 44 px |
| L2.5.3 | §3.6.2 fold — attendance % / avg children / image % / video % / SoM MoM tiles, 6-month trend chart, "View More" per-village drill, scope preserved on metric switch |

## Decisions that landed with L2.5

- **D12** Consolidated dashboard folded into §3.6.1, not built as a
  separate screen.
- **D13** Image % / video % denominators are per scheduled
  attendance session in scope × date range.
- **D14** The consolidated KPI pack renders at every drill level,
  not only cluster.

## Documents updated alongside

- `mvp/level-3.md` — Consolidated dashboard entry deleted; L3
  rescoped to Master Creations + Profile.
- `mvp/README.md` — L2.5 row added.
- `requirements/03-functional.md` §3.6.2 — rewritten to defer the
  mechanics to §3.6.1; numbering stable.

## Carry-overs into open items

- **U8** `avg_children` denominator (review-findings) — currently
  `total_marks / total_attendance_sessions` (all scheduled), flagged
  by PR #31 review #6. Pin in §3.6.2 once ops chooses.
- **L7** IST-vs-UTC date drift — fixed in `consolidatedMediaPct`;
  the same `strftime('%Y-%m', captured_at, 'unixepoch')` pattern
  in `insights.ts` (lines ≈ 243, 323) still wants a sweep. Flagged
  by PR #31 review #5.

## Notes

- iPhone 13 mini (375×812) is the baseline. Tailwind defaults stay
  (`sm: 640 px`); no custom `xs` breakpoint.
- Screenshots for the PR body live under `mvp/screenshots/l2.5/`.
