# Level 3 — Master CRUD + secondary screens

**Status:** not started. Requires L2 + L2.5 landed.

## Goal

Close the vendor-parity UI surface. Everything a user sees in the
vendor app is now present in the bespoke app, still online-only
with trivial auth.

## In scope

- **Master Creations (§3.8.7).** Super Admin screens for:
  villages, schools, events / activities, users, qualifications.
  Each screen is dedicated (not a generic table editor). No "app
  settings" screen — `app_settings` was removed in L2.0
  (decisions.md D1); retention is out-of-system.
- **Secondary screens.**
  - Profile (§3.8.1) — read-only, "Report an error" mailto link.
  - Notice board (§3.8.2) — scope-filtered list + Super/admin
    posting within scope.
  - About Us (§3.8.3) — static, editable by Super Admin, versioned.
  - Reference links (§3.8.4).
  - Quick Phone / Quick Video (§3.8.5).
  - Language switcher (§3.8.6) — en / kn / ta. i18n catalogs live
    in the web app; switch persists per user.

## Explicitly deferred

- Offline (§3.7, §6) — L4.
- Auth hardening and compliance (§3.1.2–§3.1.4, §9) — L5.

## Acceptance

1. Super Admin can create a new village through Master Creations
   and it appears immediately in the VC / AF village picker.
2. A Cluster Admin can post a notice scoped to their cluster; a
   VC in another cluster does not see it.
3. Language switcher flips all static strings in-session and
   persists across re-login (read from `user.preferred_language`
   claim, fallback `localStorage`).
4. *(App-settings acceptance criterion removed — see decisions.md
   D1. Retention is out-of-system; there is no in-app knob.)*
5. *(Consolidated-dashboard acceptance moved to L2.5.3 — see
   decisions.md D12. §3.6.2 now lives inside the drill-down
   dashboard, not a separate L3 screen.)*

## Notes

- i18n: default to English-only strings in source, externalized
  into `locales/en.json`. Add `kn.json` + `ta.json` stubs with
  English fallback so the switcher can be wired without blocking
  on translation delivery.
- Consolidated dashboard (§3.6.2) is **not** an L3 deliverable —
  it was folded into the drill-down dashboard in L2.5.3
  (decisions.md D12).
