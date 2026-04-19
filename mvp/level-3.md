# Level 3 — Consolidated dashboards + master CRUD + secondary screens

**Status:** not started. Requires L2 landed.

## Goal

Close the vendor-parity UI surface. Everything a user sees in the
vendor app is now present in the bespoke app, still online-only
with trivial auth.

## In scope

- **Consolidated dashboard (§3.6.2).** Date selector (single day /
  range). Cluster picker (scope-bound). Metrics: attendance %,
  average children, image % / video % (uploads vs expected), SoM
  current vs previous month, bar chart. "View More" drills to
  per-village rows.
- **Master Creations (§3.8.7).** Super Admin screens for:
  villages, schools, events / activities, users, qualifications,
  app settings / retention. Each screen is dedicated (not a
  generic table editor).
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
2. Consolidated dashboard for a selected range matches the sum
   of drill-down tiles over the same range.
3. A Cluster Admin can post a notice scoped to their cluster; a
   VC in another cluster does not see it.
4. Language switcher flips all static strings in-session and
   persists across re-login (read from `user.preferred_language`
   claim, fallback `localStorage`).
5. Editing `app_settings.media_retention_days` updates the value
   Super Admin sees on next load (retention cron itself is L5).

## Notes

- i18n: default to English-only strings in source, externalized
  into `locales/en.json`. Add `kn.json` + `ta.json` stubs with
  English fallback so the switcher can be wired without blocking
  on translation delivery.
- "View More" can reuse the L2 drill-down components.
