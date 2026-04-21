# Decisions

[← Index](./README.md)

Outcomes of review-findings discussions and MVP session calls. This
file is the **durable record** — the spec text is updated to match
in the same commit the decision lands. Each row has a one-line
justification.

---

## 2026-04-21 — L2.5 scoping (dashboard polish + §3.6.2 fold)

| # | Decision | Supersedes |
|---|---|---|
| D12 | **Consolidated dashboard (§3.6.2) is folded into the drill-down dashboard (§3.6.1), not built as a separate screen.** The live L2 dashboard already carries a KPI strip and attendance-trend chart; L2.5.3 extends both with the §3.6.2 metric pack (image %, video %, SoM MoM) and a "View More" per-village drill. One page, one URL, one edge-cache key. L3 scope shrinks to Master Creations + Secondary screens. | L3's "Consolidated dashboard" bullet (mvp/level-3.md prior to 2026-04-21); any earlier assumption that §3.6.2 ships as its own route. |
| D13 | **Image % and video % denominators are per scheduled attendance session in scope × date range.** A session counts toward the `image_pct` numerator if at least one image is tagged to the same event / village / day, and toward `video_pct` likewise. This reuses data the schema already has — no new "expected media count" field. §3.6.2's "uploads vs expected" phrasing is pinned to this definition. | §3.6.2's undefined "expected" baseline (ambiguous between per-day, per-session, per-village). |
| D14 | **The consolidated KPI pack renders at every drill level, not only cluster.** §3.6.2 originally framed the Consolidated view as cluster-scoped (a vendor-app holdover). In our single-tenant build, showing the same pack at India / Zone / State / Region / District / Cluster / Village gives one coherent dashboard and saves a second screen. The §3.6.2 cluster-specific "View More" button still renders at cluster level only, because village is already the leaf. | §3.6.2's implicit "cluster-only" scope. |

### Follow-on spec / mvp cleanups (same commit as D12–D14)

- `mvp/level-2.5.md` created (new file; sub-levels L2.5.1 / 2 / 3).
- `mvp/level-3.md` — Consolidated dashboard entry removed; title
  shortened to "Master CRUD + secondary screens"; acceptance list
  no longer references the consolidated dashboard; note inserted
  pointing at L2.5.3 + D12.
- `mvp/README.md` — ladder table gains an L2.5 row between L2 and L3.
- `mvp/level-2.md` — Status line notes L2.5 as the polish follow-on.
- `requirements/03-functional.md` §3.6.2 — rewritten to describe
  the fold: the section now defers mechanics to §3.6.1, records the
  D13 denominator, and affirms the D14 every-level scope. Section
  numbering is stable per CLAUDE.md; the header stays.

---

## 2026-04-20 — L2 kickoff

| # | Decision | Supersedes |
|---|---|---|
| D1 | Drop the `app_settings` table entirely. Retention timelines (student records, media) are handled **outside this system** — by ops, not by a Worker cron. Anything else `app_settings` was going to hold (session TTL, default language) moves to Worker env vars or code constants. | Review-findings U5 (Add `student_retention_years` to `app_settings`), L1-review H5 (create empty `app_settings` now). Both superseded. |
| D2 | Downgrade "Excel export" (§3.6.3, §5.10) to **CSV** for L2 and L3. True `.xlsx` is deferred to L5 (if it ever returns a net win over CSV). CSV is one function, zero dependencies, and every spreadsheet tool opens it. | — |
| D3 | **Defer R2 to the end of L2** (level 2.4). L2.0–L2.3 run against local D1 only; wrangler's `--local` R2 stands up the pipeline in L2.4. Production R2 binding is deferred until the first real deploy. | — |
| D4 | **No retention cron, no retention sweep worker, no `retained_until` pin.** Both the `media-retention` cron (§7.7) and the `retention-sweep` Worker (§11.3) are removed from the spec. Media deletion is a manual ops task for the lab; a deployment-time decision for production. | — |

### Follow-on spec cleanups (same commit as D1–D4)

- §4.3.8 (data model) — section removed; `audit_log` becomes §4.3.8.
- §7.7 (media retention) — replaced with a one-paragraph note that
  retention is out-of-system.
- §9.3 (compliance retention) — rewritten to describe the
  out-of-system boundary. Audit-log retention stays as an open item
  (ops question, not app config).
- §5.13 (`/api/settings`) — endpoint removed.
- §3.8.7 (Master Creations) — `retention settings` entry removed.
- §2.3 (capability matrix) — `Retention / app settings` row removed;
  Super Admin's only remaining exclusive capability is `Manage users`
  plus master CRUD.
- §2.1 (actors) — Super Admin description no longer mentions
  "retention config".
- §10 (migration) — `legacy_settings → app_settings` row removed
  from the master-data migration list; the vendor's config is
  retained only as reference for our env-var defaults.
- §11.3 (Workers) — `retention-sweep` Worker deleted. The three
  Workers are now `api` + `derive-media` + `migrator`.
- §11.7 (Queues) — `retention-sweep-media` queue deleted.
- §11.9 (Secrets) — `GRAFANA_CLOUD_PUSH_URL` surface list drops
  `retention-sweep`.
- §11.10 (CI/CD) — `/workers/retention-sweep` removed from the repo
  layout.
- §11.12 open items — the audit-log retention item (§9.6) stays
  because that's an ops policy, not an `app_settings` knob.

---

## 2026-04-20 — L2.3 PR #24 review

| # | Decision | Supersedes |
|---|---|---|
| D5 | **CSV exports carry no context line.** §3.6.3 says "CSV mirrors the on-screen table exactly". Inline `# India > Zone > …` comments are not RFC-4180 comments — Excel and pandas treat `#` as data, so the trail surfaces as a rogue one-cell row. Context lives in the **filename** instead: `<metric>_<level>[_<crumb>][_<from>_to_<to>].csv`. Two downloads from the same page with different scope or period therefore land as distinct files, not overwrites. | Earlier L2.3 draft that prepended `# trail` to each CSV. |
| D6 | **CSV cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` are prefixed with `'` before emit.** CWE-1236 (formula injection). Achievement descriptions are free-form VC input and the CSV is the only artefact users open in a spreadsheet. The single-quote prefix is interpreted as a text marker by Excel / Sheets / LibreOffice (not rendered in most views) and is safe literal data for programmatic CSV parsers. | — |

---

## 2026-04-20 — L2.4 kickoff (media pipeline scope)

| # | Decision | Supersedes |
|---|---|---|
| D7 | **L2.4 ships photo + voice-note + video under a single-PUT path with a 50 MiB raw cap across all three kinds.** Capture UX (camera / mic, preview, tag picker, AF village-pick) is identical across kinds; the differences live in the upload path, and we collapse them by capping size rather than splitting the feature. Presign returns one `upload_url`; client does one PUT; server commits after HEAD-verifies. | §7.2 per-kind caps (image 8 MiB, video 200 MiB, audio 16 MiB) — the wider caps return whenever multipart lands. |
| D8 | **Defer client-side video transcode (ffmpeg.wasm) to L2.4b or later.** §7.2's "mandatory transcode to 720p / ≤ 2 Mbps if source > 50 MiB" is unreachable without it, and the 50 MiB cap from D7 makes transcode moot for MVP content. The §7.8 acceptance target ("5-min 1080p over 3G in ≤ 5 min") is therefore **not** claimed in L2, even though the `/capture` page ships a video recorder — short lab-quality clips work, full-length 1080p recordings will refuse to upload with a cap-exceeded error until L2.4b lands. | — |
| D9 | **Defer R2 multipart (`upload_id` + `part_urls[]` + `POST /api/media/presign/parts`) to L2.4b or later.** The 50 MiB cap from D7 fits R2's single-PUT limit with room to spare; multipart returns together with transcode when we lift the cap. | §7.3 step 4 (> 10 MiB ⇒ multipart). |
| D10 | **Skip the `com.navsahyog.gps` container-metadata sidecar for video / audio.** Spec §7.2 already says "server trusts the body; the sidecar is a forensics backup" — the DB row + outbox body remain the source of truth. Writing MP4 `©xyz` / Matroska tags in-browser is a separate engineering task with no MVP payoff. EXIF GPS on images (native-format) is still preserved. | §7.2 sidecar requirement for video/audio. |
| D11 | **Defer the `media-derive` queue + thumbnails to L2.5 or L3.** No Queues binding is wired yet; list endpoints return the original object key as both `url` and `thumb_url` with a TODO. §7.5's "list views use `thumb_url`" still holds at the API contract level — the values just happen to point at the original until the derive consumer ships. | §7.4 derived renditions during L2. |

### L2.4b / follow-up backlog (tracked here, not in review-findings)

- Client video transcode via ffmpeg.wasm (§7.2, unblocks §7.8 acceptance).
- R2 multipart + resume-from-last-good-part (§7.3).
- MP4 / Matroska GPS sidecar writer (§7.2 forensics backup).
- `media-derive` Queues consumer + Cloudflare Images vs `wasm-vips` call (§7.4, §7.9 open item).

---

## How to use this file

- **Add a row at the top** (reverse-chronological) when a review
  meeting or working session produces a new decision.
- **Update the spec in the same commit.** If a decision touches §X
  and §Y, both sections change together with the `decisions.md`
  update.
- **Don't reopen.** If a decision needs to be revisited, add a new
  row that supersedes it explicitly, and re-edit the spec. The old
  row stays (with its date) for history.
