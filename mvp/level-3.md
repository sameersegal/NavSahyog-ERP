# Level 3 — Master CRUD + Profile + Field-Dashboard Home

**Status:** in flight. L3.0 landed (PR #40): §3.6.4 Field-Dashboard
Home, doer branch end-to-end. L3.0b in flight: observer Home —
symmetric shape with multi-KPI Focus Areas + Compare-all link to
`/dashboard`. D19 amended to drop the original "full sibling-compare
grid as primary block" framing; the grid lives more comfortably one
tap away on `/dashboard`. **L3.1 Master Creations** scoped (D21–D24)
and ready to start; **L3.2 Profile** (§3.8.1) carved out as a
follow-on slice — read-only screen, no schema changes, ships once
L3.1 lands.

## Sub-levels

| Sub | Scope | Status |
|---|---|---|
| L3.0 | §3.6.4 Field-Dashboard Home — doer branch | landed (PR #40) |
| L3.0b | §3.6.4 Field-Dashboard Home — observer branch | in flight |
| L3.1 | §3.8.7 Master Creations — villages, schools, events / activities, qualifications, users (D21–D24) | scoped, not started |
| L3.2 | §3.8.1 Profile — read-only page | carved out, not started |

## Goal

Close the remaining vendor-parity UI surface and give every role a
role-appropriate landing page. After D15's cancellation of the
content-hub screens, the level carries Master Creations + a
read-only Profile screen; D17–D20 add the new Field-Dashboard Home
as the default `/` for every authenticated user.

## In scope

- **L3.0 / L3.0b — Field-Dashboard Home (§3.6.4).** New default
  `/` for every role. Capability-gated composition: doer roles
  (any `.write` cap) see Greeting + Health Score + Today's
  Mission + Focus Areas + Capture FAB; observer roles (read-only)
  see Greeting + Health Score + Focus Areas (multi-KPI rows) +
  Compare-all link to `/dashboard`. Time filter is presets only
  (7D / 30D / MTD); custom range stays on `/dashboard`. See
  decisions.md D17–D20.
- **L3.1 — Master Creations (§3.8.7).** Super Admin screens for:
  villages, schools, events / activities, qualifications, users.
  Each screen is dedicated (not a generic table editor). Five new
  write capabilities (`village.write`, `school.write`,
  `event.write`, `qualification.write`, `user.write`) added to
  `apps/api/src/policy.ts`, granted only to Super Admin per the
  §2.3 matrix; routes gate via `requireCap(...)`. Soft-delete
  via `deleted_at` is the only delete primitive. `event.kind`
  immutability (review-findings H5) enforced server-side. User
  passwords stay plain-text (L1/L2 seed parity); L5 sweep
  replaces both. **No schema changes** — every master already
  has its row in `db/`. No "app settings" screen —
  `app_settings` was removed in L2.0 (decisions.md D1); retention
  is out-of-system. No "roles" master — roles are hardcoded in
  `policy.ts`. See decisions.md D21–D24.
- **L3.2 — Profile (§3.8.1).** Read-only page showing name, user
  ID, date of joining, role, assigned geo scope, with a "Report
  an error" mailto link to the user's AF. Carved out of L3.1 to
  keep that slice focused on the master CRUD surface.

## Cancelled (decisions.md D15)

The five content-hub screens previously scoped here are removed:
Notice board (§3.8.2), About Us (§3.8.3), Reference links (§3.8.4),
Quick Phone / Quick Video (§3.8.5), and the dedicated Language
switcher screen (§3.8.6). Section numbers retained in §3.8 for
stable cross-references; tables and API routes are gone from §4
and §5. The in-menu language toggle already ships with L2.5.

## Explicitly deferred

- Offline (§3.7, §6) — L4.
- Auth hardening and compliance (§3.1.2–§3.1.4, §9) — L5.
- Media pipeline follow-ups — see [`level-2.4b.md`](./level-2.4b.md)
  for the P1–P3 backlog (thumbnails via `media-derive` Queues,
  ffmpeg.wasm transcode, R2 multipart + resume, EXIF GPS
  extraction, AWS4 presigned URLs, MP4 / Matroska GPS sidecar).

## Acceptance

**L3.0 / L3.0b — Home:**

1. A VC lands on `/` (not `/village/:id`) and sees Health Score +
   Today's Mission + Focus Areas + Capture FAB.
2. A State Admin lands on `/` and sees Health Score + Focus Areas
   (multi-KPI rows over their direct-child scopes) + a Compare-all
   link to `/dashboard`; no Mission card, no FAB.
3. Switching the Home time preset (7D / 30D / MTD) issues exactly
   one `/api/dashboard/home` fetch and refreshes all blocks
   consistently.

**L3.1 — Master Creations:**

4. Super Admin creates a new village through Master Creations and
   it appears immediately in the VC / AF village picker.
5. Super Admin creates a school under that village; it appears in
   the school picker for child registration.
6. Super Admin creates an event with `kind=activity`, then attempts
   a PATCH to flip `kind` to `event` after a media or attendance
   row references it — the request fails with 409 and the form
   read-disables the field for the same condition.
7. Super Admin creates a user with role=VC, scope=`village:<uuid>`;
   that user can log in and lands on the doer Home.
8. A non-Super-Admin issuing any `POST /api/<master>` (or PATCH /
   soft-delete) gets 403 from `requireCap`, not from a route-
   internal role check.

**L3.2 — Profile:**

9. A VC opens their own Profile page and sees name, role,
   joined-at, and assigned geo scope.

**Removed / superseded acceptance:**

10. *(App-settings acceptance criterion removed — see decisions.md
    D1. Retention is out-of-system; there is no in-app knob.)*
11. *(Consolidated-dashboard acceptance moved to L2.5.3 — see
    decisions.md D12. §3.6.2 now lives inside the drill-down
    dashboard, not a separate L3 screen.)*
12. *(Notice / About / References / Quick / Language-switcher
    acceptance removed — cancelled in decisions.md D15.)*

## Notes

- i18n infrastructure ships in L2.5; en + hi catalogs are already
  in place, and the user-menu toggle is the only switcher affordance.
- Consolidated dashboard (§3.6.2) is **not** an L3 deliverable —
  it was folded into the drill-down dashboard in L2.5.3
  (decisions.md D12).
