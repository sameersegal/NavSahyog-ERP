# Level 2 — Full write loop + full drill-down dashboards

**Status:** not started. Requires L1 landed.

## Goal

Every daily-capture workflow a field user performs, and every
drill-down view a manager uses. Auth stays trivial.

## In scope

- **All admin roles (§2.1, §2.3).** Add District / Region / State /
  Zone Admin to the seed and to the scope-enforcement logic.
- **Children full form (§3.2.2, §3.2.3, §3.2.4).**
  - Parent fields: father / mother name + phone + smartphone flag;
    alt contact required when neither parent has a smartphone.
  - Child photo via R2 presigned PUT (§7).
  - Edit child, graduate child (graduation date + reason).
- **Attendance full form (§3.3).** Event picker from seeded events,
  today / today-1 / today-2 window, start/end time, voice note
  (audio blob to R2).
- **Capture (§3.4).** Camera / video via browser APIs. Tag event or
  activity. EXIF GPS extract; `navigator.geolocation` fallback.
  R2 multipart for video. AF village-pick at upload.
- **Achievements (§3.5).** SoM / Gold / Silver. Per-month SoM
  uniqueness enforced by the partial unique index (§4.3.6).
- **Drill-down dashboard, all 5 tiles (§3.6.1).** VC / AF / Children
  / Attendance / Achievements. Full India → Zone → State → Region →
  District → Cluster → Village drill. Excel export at every level
  (§3.6.3).

## Explicitly deferred

- Consolidated dashboard (§3.6.2) — L3.
- Master Creations (§3.8.7) — L3.
- Secondary screens (§3.8.1–§3.8.6) — L3.
- Offline (§3.7, §6) — L4.
- Auth hardening (§3.1.2–§3.1.4) — L5.
- Audit log, retention, compliance (§9) — L5.

## Acceptance

1. VC can submit a full attendance session (event + voice note)
   and the village chip turns green for that date.
2. AF uploading a photo is prompted to pick a village; the photo
   appears on the attributed village's detail screen.
3. Adding a second SoM for the same student in the same month
   replaces the first (dashboard count stays at 1).
4. Graduating a child removes them from attendance lists for
   sessions after the graduation date.
5. District+ admin dashboard shows data aggregated across all
   clusters in their district; Excel export matches the on-screen
   table column-for-column.
6. A District admin request for a sibling district returns `403`.

## Notes

- L2 is the widest level. Consider splitting into 2a (writes) and
  2b (dashboards) if review bandwidth becomes the bottleneck.
- R2 multipart failure handling: retry from last good part; surface
  a clear error banner if all retries exhausted. No silent drop.
