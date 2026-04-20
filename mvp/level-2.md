# Level 2 — Full write loop + full drill-down dashboards

**Status:** in progress. L1 merged (PRs #18–#21). L2.0 and L2.1 landed
(PR #22). L2.2 landed (PR #23). L2.3 landed (PR #24). L2.4 in flight
on `claude/l2.4-media-wTcDW`.

## Goal

Every daily-capture workflow a field user performs, and every
drill-down view a manager uses. Auth stays trivial.

## L2 ordering (decisions.md, 2026-04-20)

L2 is split into five sub-levels. Each sub-level is a self-contained
PR; the whole thing rolls up to one "L2" status line when 2.4 lands.

| Sub | Theme | Status |
|---|---|---|
| **L2.0** | Decisions landed + `app_settings` dropped + `wrangler d1 migrations` tool + District/Region/State/Zone admin roles end-to-end | ✅ |
| **L2.1** | Children full form — parents, alt contact, edit, graduate. No photo (media is L2.4). | ✅ |
| **L2.2** | Attendance full form — event picker, today/-1/-2 window, start/end time. No voice note (media is L2.4). | ✅ |
| **L2.3** | Achievements + full drill-down dashboard across all geo levels + **CSV** export (decisions.md D2). | ✅ |
| **L2.4** | Media pipeline end-to-end against wrangler `--local` R2: presign / commit, child photo, voice note, capture screen (photo + video + audio) with EXIF + geo, 50 MiB single-PUT cap across all kinds (decisions.md D3, D7–D11). Production R2 binding deferred to first real deploy. | 🚧 |

## In scope (across the five sub-levels)

- **All admin roles (§2.1, §2.3).** Add District / Region / State /
  Zone Admin to the seed and to the scope-enforcement logic.
- **Children full form (§3.2.2, §3.2.3, §3.2.4).**
  - Parent fields: father / mother name + phone + smartphone flag;
    alt contact required when neither parent has a smartphone.
  - Child photo via R2 presigned PUT (§7) — L2.4.
  - Edit child, graduate child (graduation date + reason).
- **Attendance full form (§3.3).** Event picker from seeded events,
  today / today-1 / today-2 window, start/end time, voice note
  (audio blob to R2 — L2.4).
- **Capture (§3.4) — L2.4.** Camera / video via browser APIs. Tag
  event or activity. EXIF GPS extract; `navigator.geolocation`
  fallback. R2 multipart for video. AF village-pick at upload.
- **Achievements (§3.5).** SoM / Gold / Silver. Per-month SoM
  uniqueness enforced by the partial unique index (§4.3.6).
- **Drill-down dashboard, all 5 tiles (§3.6.1).** VC / AF / Children
  / Attendance / Achievements. Full India → Zone → State → Region →
  District → Cluster → Village drill. **CSV** export at every level
  (§3.6.3; decisions.md D2).

## Explicitly deferred

- Consolidated dashboard (§3.6.2) — L3.
- Master Creations (§3.8.7) — L3.
- Secondary screens (§3.8.1–§3.8.6) — L3.
- Offline (§3.7, §6) — L4.
- Auth hardening (§3.1.2–§3.1.4) — L5.
- Audit log, compliance (§9) — L5.
- Retention cron — **cancelled** (decisions.md D4; out-of-system).

## Acceptance

1. VC can submit a full attendance session (event + voice note,
   voice note landing in L2.4) and the village chip turns green
   for that date.
2. AF uploading a photo (L2.4) is prompted to pick a village; the
   photo appears on the attributed village's detail screen.
3. Adding a second SoM for the same student in the same month
   replaces the first (dashboard count stays at 1).
4. Graduating a child removes them from attendance lists for
   sessions after the graduation date.
5. District+ admin dashboard shows data aggregated across all
   clusters in their district; CSV export matches the on-screen
   table column-for-column.
6. A District admin request for a sibling district returns `403`.

## Notes

- R2 runs against wrangler `--local` throughout L2.4. Production
  bucket binding is a deploy-time concern.
- R2 multipart failure handling (L2.4): retry from last good part;
  surface a clear error banner if all retries exhausted. No silent
  drop.
