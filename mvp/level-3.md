# Level 3 — Master CRUD + Profile

**Status:** not started. Requires L2 + L2.5 landed.

## Goal

Close the remaining vendor-parity UI surface. After D15's
cancellation of the content-hub screens, the level shrinks to
Master Creations + a read-only Profile screen.

## In scope

- **Master Creations (§3.8.7).** Super Admin screens for:
  villages, schools, events / activities, users, qualifications.
  Each screen is dedicated (not a generic table editor). No "app
  settings" screen — `app_settings` was removed in L2.0
  (decisions.md D1); retention is out-of-system.
- **Profile (§3.8.1).** Read-only page showing name, user ID,
  date of joining, role, assigned geo scope, with a "Report an
  error" mailto link to the user's AF.

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

1. Super Admin can create a new village through Master Creations
   and it appears immediately in the VC / AF village picker.
2. A VC can open their own Profile page and see name, role,
   joined-at, and assigned geo scope.
3. *(App-settings acceptance criterion removed — see decisions.md
   D1. Retention is out-of-system; there is no in-app knob.)*
4. *(Consolidated-dashboard acceptance moved to L2.5.3 — see
   decisions.md D12. §3.6.2 now lives inside the drill-down
   dashboard, not a separate L3 screen.)*
5. *(Notice / About / References / Quick / Language-switcher
   acceptance removed — cancelled in decisions.md D15.)*

## Notes

- i18n infrastructure ships in L2.5; en + hi catalogs are already
  in place, and the user-menu toggle is the only switcher affordance.
- Consolidated dashboard (§3.6.2) is **not** an L3 deliverable —
  it was folded into the drill-down dashboard in L2.5.3
  (decisions.md D12).
