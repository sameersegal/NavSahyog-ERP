# Decisions

[← Index](./README.md)

Outcomes of review-findings discussions and MVP session calls. This
file is the **durable record** — the spec text is updated to match
in the same commit the decision lands. Each row has a one-line
justification.

---

## 2026-04-26 — L3.1 Master Creations scope

| # | Decision | Supersedes |
|---|---|---|
| D21 | **L3.1 ships Master Creations as a single slice covering five masters: villages, schools, events / activities, qualifications, users.** One dedicated screen per master (not a generic table editor, restated from §3.8.7 so it isn't relitigated). The five share enough scaffolding — `requireCap(...)` gates, soft-delete via `deleted_at`, list / create / edit form shape — that splitting them buys two rounds of the same review without buying isolation. Profile (§3.8.1) is **not** in this slice; it lands as L3.2. "Roles" is **not** a master in this slice — roles are hardcoded in `apps/api/src/policy.ts` per CLAUDE.md, so a creation surface would be dead UI. A read-only "roles & capabilities" reference page can land later if it earns its keep. No bulk import / CSV upload — out of §3.8.7 scope; add only when a real onboarding workflow demands it. No hard delete — soft-delete is the only delete primitive across the spec. **No schema changes.** Every master already has its row in `db/`; this slice is API write endpoints + UI screens + policy.ts diff only. | `mvp/level-3.md` "Master Creations + Profile" combined scope (re-sliced for delivery — Profile carved out, Master Creations isolated). |
| D22 | **Five new write capabilities land on `apps/api/src/policy.ts`: `village.write`, `school.write`, `event.write`, `qualification.write`, `user.write` — granted only to Super Admin per the §2.3 matrix.** Read caps stay broad (existing list endpoints already serve the dashboards). Routes use the existing `requireCap(...)` middleware; non-Super-Admin POST/PATCH returns 403 from the gate, not from a route-internal role check. This closes B3's "structurally read-only via the policy layer" promise for the write side too — the data shape is identical to the existing read-cap rows. | Any earlier framing that left write gates implicit on master endpoints. |
| D23 | **`event.kind` immutability (review-findings H5) is enforced server-side by the L3.1 PATCH route, not just UI-disabled.** PATCH `/api/events/:id` rejects a `kind` change with `409 event.kind frozen — has N referencing rows` once any media or attendance row references the event. The form read-disables the field for the same condition based on a `kind_locked: boolean` field on the GET response. H5 closes when L3.1 lands. | H5's open state in `review-findings-v1.md`. |
| D24 | **User create writes plain-text passwords in L3.1, matching the existing L1/L2 seed.** The `users.password` column receives the operator-typed password directly; an L5 sweep (per `mvp/level-5.md`) replaces both seed and Master-Creations writes with Argon2id at the same time. Adding hashing here would be half-built — the seed and the existing login flow would still treat the column as plain text, and the change wouldn't survive L5 anyway. The form carries a single `// L5: argon2id` TODO mirroring the seed-script TODO so the sweep is mechanical. | Earlier instinct to bring hashing forward "while we're here" — leaks an inconsistent partial security posture. |

### Follow-on spec / mvp cleanups (same commit as D21–D24)

- `mvp/level-3.md` — sub-levels enumerated (L3.0 doer Home ✅,
  L3.0b observer Home in flight, **L3.1 Master Creations** new,
  L3.2 Profile carved out). Acceptance list re-numbered to scope
  each criterion to the sub-level that owns it.
- `requirements/03-functional.md` §3.8.7 — no body change; the
  trimmed master list (no roles, no app settings) already matches
  D21. Section header stable per CLAUDE.md numbering rule.
- `requirements/review-findings-v1.md` H5 — leave open until the
  L3.1 implementation PR lands; that PR's commit message closes
  H5 and updates the row.
- `apps/api/src/policy.ts` — implementation diff (five new write
  caps + Super-Admin grants) lands with the L3.1 code PR, not
  this spec PR. Listed here so the dependency is explicit.

---

## 2026-04-24 — L3.x Field-Dashboard Home

| # | Decision | Supersedes |
|---|---|---|
| D17 | **Introduce §3.6.4 Field-Dashboard Home as the default landing for every authenticated user.** One route `/`, capability-gated composition: doer roles (any `.write` cap) see Greeting + Health Score + Today's Mission + Focus Areas + Capture FAB; observer roles (read-only, District+) see Greeting + Health Score + Focus Areas + Top-N compare snapshot. Same route, different blocks, decided server-side from the caller's capability set — not from role name. VCs with a single village no longer auto-redirect; they land on Home like everyone else. The previous `/` (India-level drill) moves to `/dashboard`. | Current `Home.tsx` which renders the India-level drill directly at `/` and auto-redirects single-village VCs to `/village/:id`. |
| D18 | **Today's Mission is server-picked, doer-only.** Server ranks the four §3.6.2 gaps (attendance %, image %, video %, SoM coverage) as `(target − current) / target` over scope × preset and returns `{kind, current, target, copy}` for the largest. Rendered only for roles with any `.write` cap; observer roles skip the card entirely. Keeps the Home responsive to scope without an SA-curated content table. | Earlier option of a hand-curated weekly mission maintained via Master Creations. |
| D19 | **Observer Home is symmetric with doer Home: same five-block skeleton, with multi-KPI Focus Areas + Compare-all link replacing Mission + FAB. The full sibling-compare grid lives on `/dashboard`, not on Home.** Both branches share Greeting + preset switch + Health Score + Focus Areas (top-3, ranked by Health Score ascending). Doer's row 5 is the Capture FAB; observer's is a single-line "Compare all N children →" link to `/dashboard` with scope and preset preserved. Doer Focus Areas surfaces the dominant-gap KPI per child (action-shaped, "South Cluster needs photo coverage"); observer Focus Areas renders a 4-KPI strip per child (comparison-shaped). The `/dashboard` consolidated fold + sortable drill-down already handle the full-density review with CSV export. Revised from the original D19 that pinned the full grid as the primary observer block — once the doer Home shipped, the asymmetric framing felt wrong, and the full grid genuinely lived more comfortably one tap away on `/dashboard` (bigger viewport, existing sort controls, CSV export). | Original D19: "Sibling-compare grid is the primary block on observer Home." Earlier phrasings that kept the compare grid on `/dashboard` only, and the interim "5-row Top-N snapshot." |
| D20 | **Home time filter is presets only: 7D (default) / 30D / MTD.** Custom from–to picker stays on `/dashboard`. One payload per preset switch; server returns trend deltas against the previous equivalent window (prev 7D, prev 30D, MTD of prior calendar month). Keeps Home scan-in-one-glance and saves an edge-cache key per arbitrary range. | §3.6.1 / §3.6.2's "two date icons" custom range applied to Home as well. |

### Follow-on spec / mvp cleanups (same commit as D17–D20)

- `requirements/03-functional.md` §3.6.4 added (new subsection;
  §3.6.1–§3.6.3 left stable per CLAUDE.md numbering rule).
- `mvp/level-3.md` — In scope gains a "Field-Dashboard Home
  (§3.6.4)" bullet; acceptance list gains a doer-vs-observer
  composition check; title broadened.
- `mvp/README.md` — L3 theme line widened to name the Home.

### Deliberately not pinned in spec (live in `defaults.md` when it lands)

- Health Score weights across attendance / image / video / SoM.
  Worker env vars; tuned out-of-spec per review-findings Medium.
- Exact gap targets for Mission ranking (e.g. "image % target =
  80"). Env vars; §3.6.2 defines the ratios, not the absolute
  thresholds.
- Observer Focus Areas KPI order in the multi-KPI strip (Health
  Score first, then attendance / image / video / SoM, vs. some
  other ordering). Component-level decision; revisit once observer
  roles are in the hands of real users.
- The full sibling-compare grid on `/dashboard` (sortable, CSV-
  exportable). D19 (revised) names this as the path for observer
  density; the grid's exact `/dashboard` shape is component work,
  tracked alongside §3.6.1.

---

## 2026-04-22 — L3 re-scoping + media-backlog visibility

| # | Decision | Supersedes |
|---|---|---|
| D15 | **Cancel §3.8.2–§3.8.6 (Notice board, About Us, Reference links, Quick Phone / Quick Video, Language switcher screen).** None of these were load-bearing for a NavSahyog workflow — they were vendor-platform carryover. Broadcasts, static org info, curated links, and contact numbers are distributed out-of-band (email / WhatsApp). The in-menu language toggle already ships in L2.5; a dedicated switcher screen adds nothing. L3 shrinks to Master Creations (§3.8.7) + Profile (§3.8.1). Section numbers in §3.8 stay (CLAUDE.md numbering rule); bodies replaced with "Cancelled — D15" notes. | Earlier L3 scope that listed all five as "secondary screens" (mvp/level-3.md prior to 2026-04-22). |
| D16 | **L2.4b media-pipeline backlog promoted to a visible row on the MVP ladder.** The follow-on work (P1 — ffmpeg.wasm transcode + R2 multipart; P2 — `media-derive` Queues consumer + thumbnails + EXIF GPS; P3 — AWS4 presigned URLs + MP4/Matroska GPS sidecar) was tracked in `mvp/level-2.4b.md` but not in `mvp/README.md`, so it was easy to miss as "pending scope". Row added between L2.5 and L3; no content change to `level-2.4b.md` itself. | `mvp/README.md` ladder that skipped L2.4b. |

### Follow-on spec / mvp cleanups (same commit as D15 + D16)

- `requirements/03-functional.md` §3.8 — bodies of §3.8.2–§3.8.6 replaced with "Cancelled — D15" notes; §3.8.1 and §3.8.7 updated to reflect the trimmed master list (no more `notices`, `reference_link`, `quick_link`, `about_us` under Master Creations).
- `requirements/04-data-model.md` §4.2 — four content-table rows flipped from **Keep** to **Drop**; §4.3.8 body replaced with a "Cancelled" note (header retained); §4.4 summary drops table count from 21 to 17.
- `requirements/05-api-surface.md` §5.12 — `/api/notices`, `/api/reference-links`, `/api/quick-links`, `/api/about` all removed; section header retained.
- `requirements/06-offline-and-sync.md` — "notices" dropped from the online-only list.
- `requirements/08-non-functional.md` — `user.preferred_language` for "OTP / notice delivery" rewritten as "OTP delivery" (notice delivery cancelled); soft-delete scope drops `notice`, `reference_link`, `quick_link`.
- `requirements/09-compliance.md` §9.6 — i18n open item updated to note the switcher screen is cancelled; in-menu toggle is the only affordance.
- `requirements/10-migration.md` §10.5 — content-hub migration block rewritten as "not migrated"; §10.8 broadcast step + §10.10 risk row reworded to "out-of-band".
- `requirements/review-findings-v1.md` U3 — marked "Resolved by D15".
- `mvp/level-3.md` — re-titled "Master CRUD + Profile"; scope reduced accordingly; media-pipeline backlog linked from "Explicitly deferred".
- `mvp/level-1.md` / `mvp/level-2.md` / `mvp/level-2.5.md` — "Explicitly deferred" rows pointing at §3.8.1–§3.8.6 reshaped to call out Profile → L3 and D15's cancellation of the rest.
- `mvp/README.md` — ladder gains an **L2.4b** row linking to `level-2.4b.md` so the media-pipeline backlog is visible at a glance (D16).

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
