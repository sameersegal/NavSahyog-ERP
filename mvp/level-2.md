# Level 2 — Full write loop + full drill-down dashboards

**Status: landed end-to-end.** PRs #22–#25 cover L2.0 through L2.4.
L2.5 (mobile-first polish + §3.6.2 fold) shipped as PR #31 — see
[`level-2.5.md`](./level-2.5.md). L2.4b (media-pipeline backlog)
remains pending — see [`level-2.4b.md`](./level-2.4b.md).

## What L2 proved

Every daily-capture workflow a field user performs, and every
drill-down view a manager uses. Auth stayed trivial.

## What shipped (per sub-level)

| Sub | Theme | PR |
|---|---|---|
| L2.0 | Decisions landed + `app_settings` dropped + `wrangler d1 migrations` tool + District / Region / State / Zone admin roles end-to-end | #22 |
| L2.1 | Children full form — parents, alt contact, edit, graduate. (Photo lands in L2.4.) | #22 |
| L2.2 | Attendance full form — event picker, today/-1/-2 window, start/end time. (Voice note lands in L2.4.) | #23 |
| L2.3 | Achievements + full drill-down dashboard across all geo levels + CSV export (D2) | #24 |
| L2.4 | Media pipeline end-to-end against wrangler `--local` R2: presign / commit, child photo, voice note, capture screen (photo + video + audio) with EXIF + geo, 50 MiB single-PUT cap across all kinds (D3, D7–D11). Production R2 binding deferred to first real deploy. | #25 |

## What was in scope

- **All admin roles (§2.1, §2.3).** District / Region / State / Zone
  added to seed + scope-enforcement.
- **Children full form (§3.2.2–§3.2.4).** Parent fields, alt-contact
  rule when neither parent has a smartphone, child photo, edit,
  graduate.
- **Attendance full form (§3.3).** Event picker, today / -1 / -2
  window, start/end time, voice note.
- **Capture (§3.4).** Camera / video via browser APIs. Tag event or
  activity. EXIF GPS extract; `navigator.geolocation` fallback. AF
  village-pick at upload.
- **Achievements (§3.5).** SoM / Gold / Silver. Per-month SoM
  uniqueness via partial unique index (§4.3.6).
- **Drill-down dashboard (§3.6.1).** All 5 tiles, full India → Zone
  → State → Region → District → Cluster → Village drill. CSV export
  at every level (§3.6.3, D2).

## What was deferred (still)

- Consolidated dashboard (§3.6.2) — folded into §3.6.1 in L2.5.3 per D12.
- Media-pipeline follow-ups (transcode, multipart, derive queue,
  thumbnails, AWS4) — see `level-2.4b.md` (D7–D11).
- Master Creations (§3.8.7) — landed in L3.1.
- Profile (§3.8.1) — L3.2.
- §3.8.2–§3.8.6 cancelled (D15).
- Offline (§3.7, §6) — L4.
- Auth hardening, audit log, compliance — L5.
- Retention cron — cancelled (D4, out-of-system).

## Notes for future work

- R2 ran against wrangler `--local` throughout L2.4. Production
  bucket binding is a deploy-time concern (L5 / first real deploy).
- R2 multipart failure handling (L2.4): retry from last good part;
  surface a clear error banner if all retries exhausted. No silent
  drop.
