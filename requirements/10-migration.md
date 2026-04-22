[← §9 Compliance](./09-compliance.md) · [Index](./README.md) · [§11 Cloudflare mapping →](./11-cloudflare-mapping.md)

---

## 10. Migration

One-shot import from the vendor's production backend into the
bespoke D1 + R2 stack, followed by a controlled dual-run cut-over.
Zero data loss.

### 10.1 Source access

The vendor stack is the Struts `.do` backend + its underlying
database (likely MySQL/Oracle, not directly exposed). Two
plausible paths, in descending order of preference:

1. **Database dump** (`mysqldump` / equivalent) delivered by the
   vendor. Fastest and most complete; requires a commercial ask.
2. **Paginated pull through existing `ListAll*` operations**
   (§5, vendor side). Slower, may miss soft-deleted rows, must be
   run from an admin login with global scope. Use this as the
   fallback.
3. **Client-side SQLite export** from a field device (last
   resort; per-device, incomplete, and blocked on reaching a
   device that has the full cache).

Media (images/videos) download path:

- The `UploadSingleImage` / `UploadSingleVideo` endpoints expose
  by-ID retrieval URLs; pulling every row from `event_image` /
  `event_video` + offline twins and fetching each URL pipes the
  bytes into R2.
- Expect 100 k – 500 k media objects total; plan for multi-day
  parallel downloads with resume.

### 10.2 Target environment

- **Staging** D1 + R2 runs the full migration first. No production
  data flows to local laptops; all ETL runs from a Worker or from
  a Cloudflare Tunnel'd jump host.
- **Production** D1 + R2 receives the final, verified extract
  during cut-over (§10.8).

### 10.3 Migration runner

A stand-alone Workers project, **`migrator`**, lives in
`/tools/migrator`. It is not part of the app Worker deploy.

- Entrypoints: Cron + admin-triggered HTTP. Not publicly
  routable; bound to a private hostname behind Cloudflare Access
  (Super Admin only).
- Writes directly to the target D1 via a service binding; writes
  media directly to R2.
- Keeps a **`migrator.state`** D1 database of its own with:
  - `vendor_table`, `vendor_pk`, `bespoke_uuid`, `imported_at`,
    `status`, `last_error`.
  - Checkpoint cursor per source table.
- Idempotent: every insert in target D1 uses
  `ON CONFLICT(uuid) DO NOTHING`; re-running the migrator
  resumes.

### 10.4 Phase plan

| Phase | Steps | Downtime |
|---|---|---|
| P0 Prep | Vendor access obtained; staging target provisioned; migrator deployed. | 0 |
| P1 Reference data | Geo, schools, events, qualifications. | 0 |
| P2 People | Users, students, program-status merges. | 0 |
| P3 Operational data | Attendance, achievements. | 0 |
| P4 Media metadata | `event_image` + `event_video` rows → `media`. | 0 |
| P5 Media bytes | R2 backfill from vendor URLs. | 0 |
| P6 Verification | Reconciliation queries (§10.7). | 0 |
| P7 Dual-run | Both apps live; vendor is read-only in new workflows. | 0 |
| P8 Cut-over | New app is canonical; vendor is read-only archive. | ~15 min |
| P9 Decommission | Vendor access terminated after 90-day grace. | 0 |

P1–P6 run on staging first. When P6 reconciles cleanly, the same
runs against production (with a fresh extract taken at P8
cut-over time).

### 10.5 Field mapping

Row-level mapping, source → target, reflecting the
drop/merge decisions in §4.2. Only notable transformations listed;
straightforward copies (`name → name`) are omitted.

**Users** — `login_user_data` + `teacher` + `teacher_pgm_status`
→ `user`:

- `login_user_data.LoginId` → `user.user_id`.
- `login_user_data.PwdHash` → `user.password_hash` if algorithm
  is compatible (**likely not**); otherwise set a fresh default
  password and `password_is_default = 1`, force change on first
  login, and notify each user out-of-band. Decision in §10.10.
- `teacher_roles_assign.RoleId` → resolve to `user.role` enum;
  reject rows with unknown roles and log for manual triage.
- `teacher_pgm_status.JoinedOn` → `user.joined_at`;
  `LeftOn` → `user.left_at`.
- `login_user_data.CorpId` → **dropped** (§1.3).
  Rows with `CorpId != NavSahyog` are filtered out.

**Geography** — `country`, `zone`, `region`, `state`,
`territory`, `taluk`, `area_cluster`, `VillageName`:

- `country` rows ignored; the fixed value is India.
- `territory` / `taluk`: if a row has no children in populated
  levels, drop; if children exist, escalate (§10.10). The
  migrator's P1 job emits a row count so the decision can be
  data-driven.
- `VillageName` → `village`; the coordinates / pincode /
  `village_pgm_status` fields merge per §4.2.

**Students** — `student` + `student_pgm_status` → `student`:

- **`student.aadhaarNo` → dropped.** Migrator never writes this
  field into target D1 (§9.1). Pre-migration validation emits a
  count of source rows with non-null Aadhaar for audit.
- `student_pgm_status.JoinedOn` → `student.joined_at`;
  `Graduated=Y` rows collapse into `student.graduated_at` +
  `graduation_reason`.
- Parent Aadhaars → stored as masked form only
  (`XXXX-XXXX-<last4>`); raw value dropped.

**Events / activities** — `events` + `eventsNew` → `event` with
`kind`:

- Deduplicate by `name` + type; if both source tables have a row,
  prefer `eventsNew` (newer vendor schema). Emit a
  `migrator.dedup_conflict` audit row if non-trivial fields
  differ.

**Attendance** — `attendance` + `attendanceOffline` →
`attendance_session` + `attendance_mark`:

- Group source rows by `(village, date, event_id)` into one
  `attendance_session`; the mark rows fan out under it.
- `attendanceOffline` rows merge into the same keys; ties go to
  the newer `created_on`. Conflicts are logged.

**Media** — `event_image` + `event_image_offline` +
`event_video` + `event_video_offline` → `media`:

- `kind = 'image'` or `'video'` based on source table.
- `r2_key` computed using §7.1 convention from the vendor's
  `created_on` and village FK; extension inferred from MIME.
- EXIF GPS copied into `media.latitude` / `media.longitude`
  (and preserved in the file itself during R2 upload).
- Video duration / size metadata copied where present.
- Retention: out-of-system (§7.7, decisions.md D1/D4). Ops handles
  R2 lifecycle directly — no `retained_until` pin, no retention
  cron. Showcase / legal-hold preservation is an operational
  convention on the bucket.

**Content** — not migrated (decisions.md D15; §3.8.2–§3.8.5
cancelled):

- `aboutus`, `notification`, `referencelink`, `quickPhoneLinks`,
  `quickVideoLinks` — no target tables in the bespoke schema.
- `legacy_settings`: **not migrated** (decisions.md D1). Reviewed
  once as a reference for the bespoke app's Worker env-var
  defaults (session TTL, OTP TTL, default language); the values
  themselves are baked into code/env, not loaded from a DB row.

**Not migrated** (vendor artefacts without a target table):

- `ngo_features`, `role_permission`, `MembershipType`,
  `country`, `territory`, `taluk` (if unused),
  `village_pgm_status` (merged), `teacher_roles`,
  `teacher_roles_assign` (merged), `student_pgm_status` (merged),
  `teacher_pgm_status` (merged), `eventsNew` (deduped),
  all `*Offline` tables (merged with their canonical pairs),
  `aboutus` / `notification` / `referencelink` /
  `quickPhoneLinks` / `quickVideoLinks` (D15 — content hub
  cancelled).

### 10.6 Media bytes backfill

- A Queues-fed Worker (`migrator-media`) pulls vendor URLs in
  batches of 32, streams each response body directly into R2
  using `@/workers-shared/r2-stream.ts`. No bytes land on local
  disk.
- Exponential backoff on 5xx from the vendor; 404s are logged
  with the `media` row ID and the row is marked
  `vendor_missing = 1`.
- Verification: after P5, every `media.r2_key` is HEADed in R2;
  missing keys go into a Super-Admin reconciliation queue.
- Expected throughput: ~10 MB/s sustained on a single worker,
  scaled horizontally via 16 consumer instances. A 500 GB corpus
  completes in < 24 h.

### 10.7 Verification & reconciliation

Runs after each phase on staging and again after P8 on
production. Implemented as SQL stored in `/tools/migrator/checks/`.

Baseline checks:

- **Row counts**: every source table's "kept" count matches the
  target table's inserted count (±0 for deterministic copies,
  ±Δ explained for merges).
- **FK integrity**: no orphan rows in target D1.
- **Null-Aadhaar invariant**: `SELECT COUNT(*) FROM student
  WHERE aadhaar IS NOT NULL` = 0. (Column doesn't exist — compile
  check suffices — but we run a schema-introspection assert.)
- **Audit invariant**: every insert during migration writes a
  row in `audit_log` with `action = 'migration.insert'` and a
  source-table tag.
- **Spot checks**: 100 randomly sampled students per cluster are
  fetched from both stacks and compared field-by-field (via a
  thin `vendor-mirror` worker that wraps vendor `getSingle*`).
- **Media parity**: for a random 0.1 % of `media` rows, SHA-256
  of the R2 object matches a fresh download from the vendor URL.
- **Dashboard parity**: P6 runs representative drill-down queries
  on both stacks and diffs the results; discrepancies > 0.5 %
  block cut-over.

All discrepancies are written to `migrator.state.discrepancy`
with severity (`block` / `warn` / `info`). Only `info` is allowed
to persist at cut-over.

### 10.8 Cut-over

During the planned 15-minute window:

1. Set vendor to read-only (either via vendor ops support or by
   switching its public URL to a 503 page for write endpoints).
2. Run an **incremental delta pull** for everything written since
   the last staging import (tracked by source `modified_on`
   columns).
3. Run P6 verification on production.
4. Flip DNS for `app.navsahyog.org` and `api.navsahyog.org` to
   Cloudflare.
5. Broadcast the cut-over to all users out-of-band (email /
   WhatsApp — the in-app §3.8.2 notice board was cancelled in D15):
   new app URL + login-first-time-with-same-user-id instructions.
6. Monitor dashboards (§8.8) for 4 hours at 100 % trace sampling.

### 10.9 Dual-run & decommission

- **Dual-run window**: 30 days. Vendor remains reachable as a
  read-only archive at a new URL
  (`archive.legacy.navsahyog.org`). New writes go only to the
  bespoke app.
- **Dual-read fallback**: if the new app 5xx rate exceeds the
  §8.8 alert threshold, a runtime flag (`feature.vendor_fallback
  = true`) routes reads for the affected resources back to the
  vendor mirror. Writes never fall back.
- **Decommission at D+90**: vendor contract terminated, access
  keys rotated, Google Maps key (§9.5) rotated, vendor DNS
  unhooked. R2 snapshot of vendor-era data retained for 1 year
  as cold backup.

### 10.10 Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Vendor refuses DB dump | Slow pull via `ListAll*` | §10.1 fallback; plan for 2-week P1-P5 instead of 3 days. |
| Password hashes incompatible | All users forced reset on D-day | Stagger: batch reset by cluster over 14 days before cut-over; each user warned out-of-band. |
| `territory` / `taluk` rows populated | Hierarchy gap in target | Dynamic decision at P1 based on count; if populated, keep the levels and extend §2.2 + §4.3.2. |
| Vendor media URL stops resolving mid-P5 | Partial media corpus | Checkpointed per object; resumable. Any unresolved media stays in `vendor_missing` list for manual chase. |
| Dashboard parity off by > 0.5 % | Trust in new system eroded | Block cut-over; diff report drills to row-level. §10.7 enforces this. |
| Field users confused by new login URL | Support burden spike | Out-of-band broadcast (email / WhatsApp) + in-vendor-app banner for 30 days before cut-over; AF-led training refresh per cluster. |

### 10.11 Open items

- [ ] Confirm vendor dump access — needed to collapse P1–P5
      timeline from weeks to days.
- [ ] Decide password-migration policy: preserve hashes (if
      algorithm known and Workers-compatible) vs force reset.
- [ ] Dual-run window duration — 30 days is a default; NavSahyog
      governance may want 60 or 90.
- [ ] Broadcast channels for cut-over communication (SMS,
      WhatsApp, in-app banner — pick at least two).
- [ ] Final go/no-go criteria: acceptable discrepancy severity
      mix, p95 latency on production after 24 h.

