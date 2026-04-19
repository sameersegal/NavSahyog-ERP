# NavSahyog ERP — Requirements Collection Handoff

## Goal
Replace the existing NavSahyog vendor app (Navshayog-4.5.2.apk, package `io.ionic.ngo`, backed by `vmrdev.com/vmr/` and `portal.viewmyrecords.com/vmr/`) with a custom ERP on the Cloudflare stack (R2 + D1 + Workers + Pages) to reduce cost and vendor lock-in.

## Sources Analyzed
- `NSF-App-Process-Document-English.txt` — NGO user onboarding / training doc.
- `Navshayog-4.5.2.apk` — decompiled by `unzip` into `/tmp/apk_extracted`.

## What's Already Been Extracted
All key info is gathered in this thread's tool output (or can be re-run from the APK). Summary:

### 1. Architecture of existing app
- **Framework**: Ionic / Angular + Cordova hybrid. `assets/www/index.html` loads Angular bundles.
- **Backend**: Java/Struts-style `.do` endpoints at `https://vmrdev.com/vmr/` (dev) and `https://portal.viewmyrecords.com/vmr/` (prod).
- **Auth**: operation-based POSTs. Flow: `mlogin.do` → `accountSetup.do` → `changeuserpassword.do` → session token. OTP flow via `otpverify.do` / `resetPasswordOTP.do`. Lock after 3 wrong attempts. Default pwd `TEST*1234` forces change on first login.
- **Offline**: SQLite (cordova-sqlite-storage). Offline actions supported: Attendance, Achievements, Photo/Video capture. "Upload Offline Data" syncs when online.
- **Multi-lang**: en, hi, ka (Kannada), ma (Malayalam), tel (Telugu), tn (Tamil).
- **Third-party**: Google Maps (key embedded — rotate), Leaflet, Hammer.js, exif-js, postalpincode.in.

### 2. Cordova plugins in use (→ Cloudflare/web replacements needed)
camera, media-capture, file / file-transfer / file-chooser / file-opener2 / filepath, advanced-http, android-permissions, app-version, badge, device, local-notification, ionic-webview, sqlite-storage, speechrecognition, nativegeocoder, pdf-generator, photoviewer.

### 3. Android permissions
CAMERA, ACCESS_FINE_LOCATION, RECORD_AUDIO, RECORD_VIDEO, READ/WRITE_EXTERNAL_STORAGE, READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, INTERNET, ACCESS_NETWORK_STATE, WAKE_LOCK, badge perms.

### 4. Data model (SQLite schemas reverse-engineered — also mirror the server model)
All tables carry `CreatedBy/ModifiedBy/CreatedOn/ModifiedOn/CorpId` audit fields and a per-table `*DataStatus` soft-delete flag. Many also carry `UploadStatus` for offline sync state.

- **Auth/Roles**: `login_user_data`, `ngo_features`, `teacher_roles`, `teacher_roles_assign`, `role_permission`.
- **Geo hierarchy (9 levels)**: `country` → `zone` → `region` → `state` → `territory` → `district` → `taluk` → `area_cluster` → `VillageName` (with lat/long/altitude/radius and pincode). `village_pgm_status` tracks village active window.
- **People**: `student` (incl. parent fields, Aadhaar — per NSNOP policy child Aadhaar must NOT be collected), `student_pgm_status`, `teacher`, `teacher_pgm_status`, `qualification`, `MembershipType`, `school`.
- **Operations**: `events`, `eventsNew`, `attendance` (+ `attendanceOffline`), `achievement` (types: SoM, Gold, Silver), `event_image`/`event_image_offline`, `event_video`/`event_video_offline` (with GPS EXIF).
- **Content**: `aboutus`, `notification`, `referencelink`, `quickPhoneLinks`, `quickVideoLinks`, `vmr_settings` (storage/retention days).

Full DDL with FK constraints is in `/tmp/schemas.txt` (35 tables). Regenerate via:
```
cd /tmp/apk_extracted/assets/www && grep -hoE 'CREATE TABLE IF NOT EXISTS [a-z_A-Z]+[^"'\'']*' *.js | awk '!seen[$0]++'
```

### 5. Backend API surface — 286 unique `operation:` codes
Grouped by verb: `Insert*`, `Update*`, `Delete*`, `ListAll*`, `getSingle*`, `Check*` (FK existence), `SystemUpdate*` (bulk reactivate), `UpdateVillageCoordinates`, `UploadSingleImage`, `UploadSingleVideo`, `getAttendanceStatusby{Level}` / `…Between`, `ListDatewise…` / `ListRangewise…` / `ListClusterWiseStarOfMonth`, `ClusterWiseStarOfPreviousMonth`, etc.

Endpoint files (Struts `.do`):
`mlogin`, `accountSetup`, `changeuserpassword`, `emailLoginId`, `emailPass`, `otpverify`, `resetPasswordOTP`, `logoff`, `changeSessionId`, `hierarchyInfo`, `villageInfo`, `schoolInfo`, `studentInfo`, `teacherInfo`, `qualificationInfo`, `permissionInfo`, `eventInfo`, `attendanceInfo`, `achievementInfo`, `imageInfo`, `videoInfo`, `fileuploadInfo`, `notificationInfo`, `aboutusInfo`, `referenceInfo`, `quicklinkInfo`, `folderNavigation`, `shareRecords`, `mobpwdInfo`.

Regenerate: `grep -hoE 'operation[A-Za-z]*:"[A-Za-z0-9_]+"' /tmp/apk_extracted/assets/www/*.js | sort -u`.

### 6. App routes / features
Home, Dashboard, Consolidated Dashboard, Set Location coordinates, Achievements, Attendance, Upload Offline Data, Server Images & Videos, Offline Images & Videos, Master Creations, Children, Download Server Data, Reset Offline Data, Notice Board, Profile, About Us, Log Out, `change-pwd`, `vmr-login`, `data-upload`, `queue-media`, `status-report`, `village-status-report`, `teacher-status-report`, plus `add-*` / `view-*` / `edit-*` CRUD pages for every master table.

Key workflows (from onboarding doc):
- **Login**: Online/Offline mode → user/pwd → forced change on default → eye toggle.
- **Children**: pick village → `+` → name, gender, DOB, school, village, (NO child Aadhaar per NSNOP), parents (name/Aadhaar/phone/smart-phone flag), alternate phone + relation, program join date, photo upload → submit.
- **Graduate**: edit child → Graduate → date + reason ("Pass Out") → submit.
- **Attendance**: date (today or past 2 days), village, start/end time, event, voice note, checkbox list, submit (village chip turns green).
- **Capture Image/Video**: capture → tag Event (AC/Special) or Activity (Board games, Kho-Kho, etc.) → save → cloud-upload. AF+ picks village on upload.
- **Achievements**: `+` → select student → description → date + type (SoM, or Gold/Silver with medal counts).
- **Dashboard**: drilldown Country → Zone → Region … → Village → Excel export.
- **Consolidated Dashboard**: single-day or range → cluster → attendance %, images/video %, SoM prev/current, bar chart, "View More" per-village.
- **Offline**: mark attendance, achievements, capture media offline → login online → Upload Offline Data.

## What's Left
1. ✅ Onboarding doc read.
2. ✅ APK decompiled; data model, API surface, plugins, permissions, routes extracted.
3. 🚧 **Write consolidated `REQUIREMENTS.md`** — split into 5 sub-tasks (below). Append each to the same file so prior sections are available as context.
4. ❌ Commit & push to branch `claude/create-requirements-file-veKWY`.

## Cross-cutting simplification principle
The existing vendor app is a **generic multi-tenant NGO platform**. Our build is **single-tenant (NavSahyog only), India-only, with known roles and known workflows**. Every sub-task below MUST call out what the bespoke nature lets us drop. Baseline simplifications to assume:
- Drop `CorpId` / multi-tenancy everywhere.
- Drop user-facing dev/prod env selector (use deploy envs).
- Drop the generic 286-operation Struts surface; redesign as ~30 REST endpoints.
- Drop `ngo_features` config table and generic `role_permission` matrix — hardcode role→capability in Workers.
- Drop `MembershipType`, `eventsNew` (dup of `events`), and other vendor artefacts unless NavSahyog actually uses them.
- Collapse the 9-level geo hierarchy to the levels actually populated (per onboarding doc: Zone → State → Region → District → Cluster → Village; Country is fixed = India; Territory/Taluk look unused).
- Trim i18n to languages NavSahyog actively uses (confirm with stakeholder; default en + kn + ta).
- PWA-first on Cloudflare Pages; wrap with Capacitor only if Play Store APK distribution is required for field users.
- Use IndexedDB + outbox for offline (drop SQLite-WASM unless a specific query needs it).

## Sub-tasks for REQUIREMENTS.md

### Part 1 — Overview, Users & Roles, Compliance
Sections: Overview & goals · Users & roles · Compliance (NSNOP).
Deliverables:
- Problem statement + Cloudflare stack rationale (cost, lock-in).
- Role catalogue: Village Coordinator (Teacher), Area Facilitator, Cluster/District/Region/State/Zone admin, Super Admin. Per-role capability matrix (read/write scope by geo level).
- Compliance callouts: **no child Aadhaar**, parent Aadhaar handling, PII minimisation, data retention (`vmr_settings.MaxDays`).

### Part 2 — Functional Requirements (workflows)
Source: §6 of this handoff + onboarding doc.
Deliverables, one sub-section per workflow with acceptance criteria:
- Auth: login (online/offline), forced default-password change, OTP reset, 3-strike lockout.
- Children: add / edit / graduate; parent + alt-phone + smartphone flag; photo.
- Attendance: date (today ± 2), village, start/end, event, voice note, checklist, green-chip feedback.
- Capture Image/Video: EXIF GPS, Tag Event (AC/Special) vs Tag Activity, cloud upload, AF village pick.
- Achievements: SoM vs Gold/Silver with medal counts.
- Dashboard (drill-down) + Consolidated Dashboard (single-day / range, cluster, bar chart, View More, Excel export).
- Offline: mark attendance / achievements / capture media; "Upload Offline Data" on reconnect.
- Profile, Notice Board, About Us, Reference Links, Quick Phone/Video Links.

### Part 3 — Data Model & API
Sections: Data model · API surface.
Deliverables:
- D1 schema (DDL) derived from §4, simplified per cross-cutting principle. Drop/merge tables that are vendor-generic. Flag every FK and every soft-delete / audit column kept.
- REST API: ~30 resource routes on Workers (e.g. `POST /api/children`, `GET /api/attendance?village=…`). Map each retained `operation:` code from §5 to a route, or mark "dropped — internal/generic".
- Auth endpoints separate: `/auth/login`, `/auth/change-password`, `/auth/otp/*`, `/auth/logout`.

### Part 4 — Offline, Media, Non-functional
Sections: Offline & sync · Media · Non-functional.
Deliverables:
- Offline: IndexedDB schema for outbox (mutations + queued media); conflict/idempotency strategy; background sync via Service Worker + Workers Queues retry; client-side encryption at rest for cached PII.
- Media: R2 multipart presigned uploads; EXIF GPS preservation; thumbnail generation (Images binding or on-demand Worker); retention per `vmr_settings.MaxDays`.
- Non-functional: i18n (trimmed language set), low-bandwidth/rural (payload budgets, image compression), auth (password policy, session TTL in KV, OTP rate-limits), audit trail (created/updated/deleted by/at), soft delete scope, observability (Workers Analytics Engine, Logpush).

### Part 5 — Migration & Cloudflare mapping
Sections: Migration · Cloudflare mapping.
Deliverables:
- Migration: one-shot import from current VMR backend (`portal.viewmyrecords.com/vmr/`) — method (export endpoints vs DB dump), field mapping vs simplified schema, media backfill to R2, validation queries, dual-run cut-over plan (read-only legacy window).
- Cloudflare mapping: concrete bindings —
  - Pages project (SPA: React/Next or keep Angular shell).
  - Workers: API, auth, R2 signer, cron (retention sweeps).
  - D1 database (schema from Part 3).
  - R2 buckets: `media-prod`, `media-staging`.
  - Queues: `offline-upload`, `retention-sweep`.
  - KV: `sessions`, `otp`.
  - Durable Objects (optional): per-cluster live counters for Consolidated Dashboard.
  - Secrets: Google Maps key (rotated), OTP provider, SMTP.

## Execution order
Do Parts 1 → 5 in order, committing after each part so progress is durable. Each commit message: `docs(requirements): part N — <section names>`.

## Useful scratch paths
- Extracted APK: `/tmp/apk_extracted/` (lost on reboot — re-run `unzip -q -o Navshayog-4.5.2.apk -d /tmp/apk_extracted`).
- SQLite DDL dump: `/tmp/schemas.txt`.
- Operation list: `/tmp/all_ops.txt`.

## Git state
- On branch `claude/collect-erp-requirements-V9tSa` (clean working tree). No new commits yet from this session.

## Caveats / notes for next agent
- Google Maps API key is baked into `index.html` — rotate before any public release.
- Backend uses generic `operation:` POST bodies (Struts-style). Don't mirror 1:1 — redesign as REST/JSON on Workers, but preserve semantic parity so data migration stays straightforward.
- Server has two environments (dev/prod); user picks at login. Replicate for staging.
- `event_image_offline` / `event_video_offline` store full binary path + GPS; plan for R2 multipart uploads with background retry.
- "Master Creations" menu item is the super-admin CRUD for every master table — gate via role_permission.
