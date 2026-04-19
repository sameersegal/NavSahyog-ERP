# NavSahyog ERP — Requirements

Status: **draft, in progress**. Written in 5 parts (see `HANDOFF.md`).
This commit adds Section 6 (Part 4a). Section numbers below are
stable; gaps are filled by later parts.

## Table of contents
1. Overview & goals ✅
2. Users & roles ✅
3. Functional requirements ✅
4. Data model ✅
5. API surface ✅
6. Offline & sync ✅
7. Media handling — *Part 4b*
8. Non-functional — *Part 4c*
9. Compliance ✅
10. Migration — *Part 5*
11. Cloudflare mapping — *Part 5*

---

## 1. Overview & goals

### 1.1 Context
NavSahyog Foundation is an Indian NGO running child-development programs
in villages across multiple states. Field staff (Village Coordinators,
Area Facilitators) record attendance, achievements, and photo/video
evidence daily. Managers view drill-down dashboards by geography.

The current mobile app (`Navshayog-4.5.2.apk`, package `io.ionic.ngo`,
backed by `vmrdev.com/vmr/` and `portal.viewmyrecords.com/vmr/`) is a
white-label product from an external vendor ("ViewMyRecords"). It is
built as a **generic multi-tenant NGO platform**: 35 master tables with
full CRUD, 286 backend operations, a user-selectable dev/prod
environment, per-tenant feature flags (`ngo_features`), a generic
role/permission matrix, and six preloaded Indian languages.

### 1.2 Goals
1. Replace the vendor app with a **bespoke ERP** that NavSahyog owns
   end-to-end.
2. Cut recurring cost and eliminate vendor lock-in by running on the
   Cloudflare stack (Pages, Workers, D1, R2, Queues, KV).
3. Preserve every field-user workflow at parity: login, children,
   attendance, capture, achievements, dashboards, offline sync.
4. Migrate existing VMR data without loss.
5. Work reliably on low-end Android phones over intermittent rural
   connectivity.

### 1.3 Non-goals (bespoke simplifications)
- **Multi-tenancy.** NavSahyog is the only tenant. Drop `CorpId` and
  any tenant-selection UI.
- **User-selectable environments.** dev/staging/prod are separate
  deployments, not a toggle on the login screen.
- **Generic "platform" flexibility.** No `ngo_features` table, no
  runtime role/permission editor, no dynamic form builder. Roles
  and screens are hardcoded to NavSahyog's actual operations.
- **Six-language support up front.** Ship with the languages actually
  used in the field (default en + kn + ta; confirm). Add others on
  demand.
- **iOS at launch.** Android + PWA only; iOS is a later decision.
- **286 generic operations.** Collapse to ~30 REST routes (spec in
  Part 3).

### 1.4 Tech-stack choice
Cloudflare-native, because it gives free/low-cost tiers at NavSahyog's
scale, edge delivery for rural low-bandwidth users, and a single vendor
for every primitive.

| Concern | Choice |
|---|---|
| Frontend | PWA on Cloudflare Pages. React + Vite (preferred over Ionic/Angular — simpler tooling, no Cordova plugins). |
| Mobile distribution | PWA install first. Capacitor wrapper only if Play Store APK is required. |
| API | Workers (TypeScript). |
| Database | D1 (SQLite). |
| Media | R2 with presigned multipart uploads. |
| Async | Queues (offline-upload retry, retention sweep). |
| Sessions / OTP | KV. |
| Live counters (optional) | Durable Objects per cluster. |

---

## 2. Users & roles

### 2.1 Actors
Derived from the onboarding doc and the decompiled app.

| Role | Scope | Primary actions |
|---|---|---|
| Village Coordinator (VC, a.k.a. Teacher) | One village | Daily attendance, achievements, capture media |
| Area Facilitator (AF) | Multiple villages in a cluster | VC actions + pick village on media upload, manage students |
| Cluster Admin | A cluster | AF actions + master data within their cluster |
| District / Region / State / Zone Admin | Respective geo level | Read-only drill-down dashboards + Excel export |
| Super Admin | Global | User management, all master CRUD, retention config |

### 2.2 Geo scope (simplified hierarchy)
```
Country (= India, fixed) → Zone → State → Region → District → Cluster → Village
```
Drop the vendor's `Territory` and `Taluk` levels unless migration turns
up populated rows (flag for confirmation).

Every user is anchored to exactly one node in this tree. Their
**effective scope** is that node and everything beneath it.

### 2.3 Capability matrix
Hardcoded in Workers (no `role_permission` table). `✔` = permitted
within the user's effective scope; `—` = denied.

| Capability | VC | AF | Cluster | District+ | Super |
|---|---|---|---|---|---|
| Login, view own profile | ✔ | ✔ | ✔ | ✔ | ✔ |
| Mark attendance | ✔ | ✔ | ✔ | — | ✔ |
| Add / edit / graduate child | ✔ | ✔ | ✔ | — | ✔ |
| Capture / upload media | ✔ | ✔ | ✔ | — | ✔ |
| Add achievement | ✔ | ✔ | ✔ | — | ✔ |
| Drill-down dashboard | own village | cluster | cluster | own level | global |
| Consolidated dashboard | — | cluster | cluster | own level | global |
| Excel export | — | ✔ | ✔ | ✔ | ✔ |
| Manage users | — | — | ✔ | ✔ | ✔ |
| Master CRUD (villages, schools, events…) | — | — | ✔ | ✔ | ✔ |
| Retention / app settings | — | — | — | — | ✔ |

**Acceptance:** every write endpoint enforces scope server-side from
the session claim. A VC cannot mark attendance for another village by
changing a request body parameter.

### 2.4 Authentication (overview; full flow in Part 2)
- Primary login is password-based, user ID assigned by admin.
- Default password `TEST*1234` on account creation; forced change at
  first login.
- Three wrong attempts lock the account; unlock requires OTP.
- Password reset via email / SMS OTP.
- Session TTL in KV; revoked on password change or admin action.

---

## 3. Functional requirements

Each sub-section lists: **inputs**, **behaviour**, **acceptance
criteria**. All writes enforce the role/scope rules from §2.3 and the
compliance rules from §9. Wording like "Today ± 2 days" is from the
onboarding doc; keep parity unless Part 3 redesigns the flow.

### 3.1 Authentication

#### 3.1.1 Login
- **Inputs**: user ID, password, network-mode selector
  (`online` / `offline`).
- **Behaviour**:
  - `online`: credentials POST to `/auth/login` → session token in
    KV → redirect to Home.
  - `offline`: validates against the last successful-login credential
    blob cached in IndexedDB (hashed, salted with device secret).
    Offline sessions are scope-limited to offline-capable workflows
    (§3.7).
  - Eye icon toggles password visibility.
- **Acceptance**:
  - 3 consecutive wrong attempts ⇒ account locked; further tries
    return a lockout message regardless of credential correctness.
  - Lock is released only via OTP reset (§3.1.3).
  - Online-mode login failure when device is offline shows a clear
    "You are offline — switch to Offline mode" message (not a
    generic network error).

#### 3.1.2 Forced password change on default password
- **Trigger**: session's user has `password_is_default = 1`.
- **Behaviour**: after login, route the user to `/change-pwd` with
  back navigation disabled. The onboarding doc instructs users to
  re-enter `TEST*1234` on first change; **our bespoke flow rejects
  that** and requires a new password meeting policy (min 8 chars,
  1 upper, 1 digit, 1 symbol).
- **Acceptance**: no authenticated route other than `/change-pwd` and
  `/auth/logout` is reachable until the password is changed.

#### 3.1.3 OTP reset / account unlock
- **Inputs**: user ID, delivery channel (email or SMS).
- **Behaviour**: POST `/auth/otp/request` issues a 6-digit code,
  stored in KV with a 10-minute TTL and max 5 verify attempts. POST
  `/auth/otp/verify` consumes it and opens a one-time password-set
  window.
- **Acceptance**:
  - Request rate-limited: max 3 OTPs per user per hour.
  - Successful reset clears the lockout and invalidates all existing
    sessions.

#### 3.1.4 Logout
- POST `/auth/logout` deletes the KV session and clears client state.

---

### 3.2 Children (student master)

#### 3.2.1 List and pick a village
- Home → **Children** → village list scoped to §2.3.
- Tapping a village opens the student list for that village, with
  the `+` FAB to add a new child.

#### 3.2.2 Add child
- **Required fields**: first name, last name, gender, DOB, school
  (picker), village (pre-filled from context, editable within scope),
  program join date, photo.
- **Parent fields** (at least one parent required):
  - Father: name, Aadhaar (optional), phone.
  - Mother: name, Aadhaar (optional), phone.
  - Smartphone flag per phone number.
  - If neither parent has a smartphone: **alternate contact**
    (phone + relationship label) becomes required.
- **Forbidden field**: child Aadhaar is not present in the form or
  schema (§9.1).
- **Behaviour**: client validation → POST `/api/children` →
  success toast. Photo uploads via R2 presigned URL (§7), row
  references the object key.
- **Acceptance**:
  - All required fields enforced client-side and server-side.
  - On submit, the child appears in the village list immediately
    (optimistic add, rollback on server error).

#### 3.2.3 Edit child
- From the student detail screen → **Edit**.
- Same validation as add; photo replacement is optional.

#### 3.2.4 Graduate child
- From the student detail screen → scroll to **Graduate** →
  graduation date + reason (enum: `Pass Out`, later-extensible).
- On success, the child's name renders in black-and-white in the
  village list (visual parity with the vendor app).
- **Acceptance**: graduated children are excluded from attendance
  lists for sessions on dates > graduation date.

---

### 3.3 Attendance

#### 3.3.1 Start a session
- Home → **Attendance** → date picker (default today; allowed range:
  today, today-1, today-2; reject anything else).
- Village picker (scope-bound). Start time, end time (24h, end ≥
  start).
- Event picker (from active events for that village). Optional voice
  note (audio blob uploaded to R2).

#### 3.3.2 Mark attendance
- Checkbox list of active (non-graduated) students for the chosen
  village and date.
- Submit posts one row per student with `present = true|false`.
- Village chip in the home screen turns **green** for the selected
  date on success.

#### 3.3.3 Acceptance
- Duplicate submission for the same `(village, date, event)` replaces
  the prior list and bumps `updated_at/by`; server returns the new
  record IDs.
- Offline submissions (§3.7) carry the local capture timestamp and
  are reconciled server-side.
- A VC cannot pick a date > today.

---

### 3.4 Capture image / video

#### 3.4.1 Capture
- Home → **Capture Video and Photo** → camera or video recorder.
- On capture, the app extracts EXIF GPS from the source file (or
  uses `navigator.geolocation` as a fallback) and stores it alongside
  the media record.

#### 3.4.2 Tag
Before upload, each item must be tagged as exactly one of:
- **Tag Event** — for Annual Competition (AC) or Special Event.
  Choose an event from the events master.
- **Tag Activity** — for daily activities (Board Games, Running Race,
  Kho-Kho, Kabaddi, Prakriti Prem, Dhan Kaushal, Jal Vriddhi, No
  Activity — Raining, No Activity — Training, …). Choose from the
  activity master.

#### 3.4.3 Upload
- Single-item upload via the cloud icon; the item disappears from
  the local queue on server ack.
- **AF-and-above**: on upload, the app prompts to pick the village
  to attribute the media to (AFs cover multiple villages). VCs skip
  this step — their village is implicit.
- Large videos use R2 multipart with resumable uploads (§7).

#### 3.4.4 Acceptance
- Every uploaded item has: media object key, tag kind (`event` /
  `activity`), event/activity FK, village FK, capture timestamp, GPS
  lat/lng (if available), uploader user ID.
- Media that fails upload stays in the local queue until success or
  manual delete.

---

### 3.5 Achievements

- Home → **Achievements** → list scoped to §2.3 → `+` FAB.
- Fields: student (picker, scope-bound), description (free text,
  max 500 chars), date, type.
- **Type = SoM (Star of the Month)**: description only. One SoM per
  student per month — a second SoM for the same month updates the
  existing row.
- **Type = Gold | Silver**: prompt for medal counts (integers ≥ 1)
  as additional fields.
- Acceptance: the dashboard's SoM counts (§3.6) reflect a new SoM
  within one refresh cycle.

---

### 3.6 Dashboards

#### 3.6.1 Drill-down dashboard
- 5 top-level tiles: **Village Coordinators**, **Area Facilitators**,
  **Children**, **Attendance**, **Achievements** (the vendor's fifth
  tile "Locations" is a drill-in starter — we fold it into each
  metric).
- Picking a metric opens India → Zone → State → Region → District →
  Cluster → Village drill (§2.2).
- Each level renders a table with the metric value and an **Excel
  download** button; tapping a row drills to the next level.
- **Acceptance**: the leaf (village) level shows per-student detail
  for Children; per-session rows for Attendance; per-award rows for
  Achievements.

#### 3.6.2 Consolidated dashboard
- Date selector: **single day** or **range** (two date icons in the
  green header strip, per the onboarding doc).
- Cluster picker (scope-bound).
- Metrics for the selection: attendance %, average children,
  image % / video % (uploads vs expected), SoM current vs previous
  month, bar chart.
- **View More** drills to per-village rows within the chosen cluster.

#### 3.6.3 Acceptance
- Excel export mirrors the on-screen table exactly (same columns,
  same order, same filter).
- A District+ admin cannot see another district's data (enforced
  server-side).

---

### 3.7 Offline mode

Detailed sync architecture is in Part 4; this section lists the
user-facing contract.

- Offline mode supports only: **Attendance**, **Achievements**,
  **Capture Image / Video**. Other menu items are hidden or
  disabled with a tooltip.
- Actions queue in an IndexedDB outbox. The home screen shows an
  outbox badge with pending count.
- On reconnect, the user goes online (re-login if needed) → Home →
  **Upload Offline Data**. Each queued item shows status
  (`pending` / `uploading` / `done` / `error`). The cloud icon
  top-right uploads all pending items; per-item retry on error.
- **Acceptance**:
  - Queued items survive app restart and device reboot.
  - A successful upload removes the item from the outbox.
  - An item that fails 5 times surfaces an error banner; it stays
    in the queue until resolved by the user (retry or delete).
  - Clock skew is tolerated: the server trusts the client's
    `captured_at` timestamp but stamps its own `received_at`.

---

### 3.8 Secondary screens

Parity with the vendor app; keep them minimal.

#### 3.8.1 Profile
- Read-only: name, user ID, date of joining, role, assigned geo
  scope. Link: "Report an error" (opens a prefilled email to the
  user's AF).

#### 3.8.2 Notice board
- List of notices (title, body, posted-by, posted-on), most-recent
  first. Scope-filtered (a notice can be global, zone-wide,
  state-wide, … down to village).
- Super Admins and scoped admins can post new notices within their
  scope.

#### 3.8.3 About Us
- Static content, editable by Super Admin. Versioned (show
  last-updated date).

#### 3.8.4 Reference links
- Curated external links (e.g. government schemes, training
  material). Fields: title, url, description, category.

#### 3.8.5 Quick Phone / Quick Video links
- Quick Phone: one-tap dial entries (role, name, phone). Quick
  Video: embedded or linked training videos.
- Managed by Super Admin.

#### 3.8.6 Language switcher
- In the side menu. Persists per user (both in KV session and in
  `localStorage` for offline). Default set: en + kn + ta (confirm
  §9.6).

#### 3.8.7 Master Creations (Super Admin only)
- Consolidated CRUD for each master (villages, schools, events,
  activities, qualifications, roles, reference links, quick links,
  notices, users, retention settings). Not a generic table editor —
  one dedicated screen per master, with only the fields the bespoke
  app actually uses.

---

## 4. Data model

Target: **D1 (SQLite)**. The vendor schema has 35 tables; the
bespoke schema collapses to **22 tables** by dropping multi-tenancy,
the generic permission matrix, duplicated "offline" tables, vendor
dedup artefacts, and unpopulated geo levels.

Full DDL is in `schema.sql` (to be added with Part 5). This section
is the canonical reference.

### 4.1 Conventions

- **IDs**: `INTEGER PRIMARY KEY` (SQLite rowid). External-facing
  resources also carry a `uuid TEXT UNIQUE NOT NULL` (generated in
  the Worker) for stable cross-environment references and for
  outbox idempotency (§6).
- **Audit columns** on every write-heavy table:
  `created_at INTEGER NOT NULL`,
  `created_by INTEGER NOT NULL REFERENCES user(id)`,
  `updated_at INTEGER NOT NULL`,
  `updated_by INTEGER NOT NULL REFERENCES user(id)`,
  `deleted_at INTEGER`,
  `deleted_by INTEGER REFERENCES user(id)`.
  Timestamps are Unix epoch seconds.
- **Soft delete**: a non-null `deleted_at` hides the row from
  normal queries. Hard delete is reserved for GDPR-style erasure
  (Super Admin path) and for retention cron (media only).
- **Scope columns**: tables that need scope filtering carry the
  lowest-applicable geo FK (`village_id`, `cluster_id`, …). Higher
  levels are derived by join.
- **Enums**: stored as short TEXT with a `CHECK` constraint, not a
  lookup table. (Lookup tables only where the set is editable by
  admins at runtime.)
- **No `CorpId`.** Single tenant (§1.3).

### 4.2 Drop / merge map (vendor → bespoke)

| Vendor table(s) | Bespoke decision |
|---|---|
| `ngo_features` | **Drop.** Single-tenant; feature set hardcoded. |
| `role_permission` | **Drop.** Capabilities hardcoded in Workers (§2.3). |
| `teacher_roles`, `teacher_roles_assign` | **Merge** into `user.role` (enum) + `user.scope_*`. |
| `login_user_data`, `teacher`, `teacher_pgm_status` | **Merge** into `user`. |
| `country` | **Drop.** Fixed = India. |
| `territory`, `taluk` | **Drop** (pending §9.6 confirmation). |
| `zone`, `region`, `state`, `district`, `area_cluster`, `VillageName` | **Keep**, renamed (`cluster`, `village`). |
| `village_pgm_status` | **Merge** into `village.program_start_date/end_date`. |
| `MembershipType` | **Drop** (single implicit type; add later if needed). |
| `student_pgm_status` | **Merge** into `student.joined_at/graduated_at/graduation_reason`. |
| `qualification` | **Keep** (referenced by user profile). |
| `school` | **Keep.** |
| `events`, `eventsNew` | **Merge** into `event`. Drop the vendor dedup artefact. |
| `attendance`, `attendanceOffline` | **Merge** into `attendance_session` + `attendance_mark`. Offline state lives in the client outbox, not a server table. |
| `achievement` | **Keep.** |
| `event_image`, `event_image_offline`, `event_video`, `event_video_offline` | **Merge** into a single `media` table (kind = `image` / `video` / `audio`). |
| `aboutus` | **Keep**, renamed `about_us`. |
| `notification` | **Keep**, renamed `notice`. |
| `referencelink` | **Keep**, renamed `reference_link`. |
| `quickPhoneLinks`, `quickVideoLinks` | **Merge** into `quick_link` (kind = `phone` / `video`). |
| `vmr_settings` | **Keep**, renamed `app_settings` (single row). |
| *(new)* | `audit_log` — append-only (§9.4). |

### 4.3 Table catalogue

#### 4.3.1 Identity & access

**`user`** — field staff and admins.
- `id`, `uuid`
- `user_id TEXT UNIQUE NOT NULL` — the login ID (e.g. `VC-BID01-007`).
- `full_name TEXT NOT NULL`
- `email TEXT`, `phone TEXT`
- `password_hash TEXT NOT NULL` (Argon2id)
- `password_is_default INTEGER NOT NULL DEFAULT 1`
- `failed_login_count INTEGER NOT NULL DEFAULT 0`
- `locked_at INTEGER`
- `role TEXT NOT NULL CHECK (role IN
   ('vc','af','cluster_admin','district_admin','region_admin',
    'state_admin','zone_admin','super_admin'))`
- `scope_level TEXT NOT NULL CHECK (scope_level IN
   ('village','cluster','district','region','state','zone','global'))`
- `scope_id INTEGER` — FK to the matching geo table by `scope_level`
  (nullable for `global`). Enforced in application code.
- `qualification_id INTEGER REFERENCES qualification(id)`
- `joined_at INTEGER NOT NULL`, `left_at INTEGER`
- *audit columns*

Indexes: `user_id`, `(scope_level, scope_id)`, `role`.

**`qualification`** — picklist for `user.qualification_id`.
- `id`, `uuid`, `name TEXT NOT NULL UNIQUE`
- *audit columns*

#### 4.3.2 Geography

All seven levels carry the same shape: `id`, `uuid`, `name`,
`code TEXT UNIQUE`, parent FK (except `zone`), audit columns.

- **`zone`** — no parent.
- **`state`** — `zone_id` FK.
- **`region`** — `state_id` FK.
- **`district`** — `region_id` FK.
- **`cluster`** — `district_id` FK.
- **`village`** — `cluster_id` FK, plus:
  - `latitude REAL`, `longitude REAL`, `altitude REAL`,
    `radius_m INTEGER` — geofence and media-GPS validation.
  - `pincode TEXT`
  - `program_start_date INTEGER`, `program_end_date INTEGER`
    (replaces `village_pgm_status`).

Indexes on every parent FK and on `code`.

#### 4.3.3 Education

**`school`**
- `id`, `uuid`, `name`, `village_id` FK, `type TEXT`
  (`government` / `private` / `anganwadi` / `other`), *audit*.

**`student`**
- `id`, `uuid`
- `first_name`, `last_name`, `gender TEXT CHECK (gender IN
   ('m','f','o'))`, `dob INTEGER NOT NULL` (date as epoch-seconds
  midnight UTC).
- `photo_media_id INTEGER REFERENCES media(id)`
- `village_id` FK, `school_id` FK
- **`aadhaar` column is intentionally absent (§9.1).**
- Parent fields (denormalised — there's no "parent" entity):
  - `father_name`, `father_aadhaar_masked TEXT`,
    `father_phone TEXT`, `father_has_smartphone INTEGER`.
  - `mother_name`, `mother_aadhaar_masked TEXT`,
    `mother_phone TEXT`, `mother_has_smartphone INTEGER`.
  - `alt_contact_name`, `alt_contact_phone`,
    `alt_contact_relationship`.
- `joined_at INTEGER NOT NULL` (program join date)
- `graduated_at INTEGER`, `graduation_reason TEXT`
  (enum: `pass_out` … extensible).
- *audit columns*

Storage rule for parent Aadhaar: **store only the masked form
(last 4 digits prefixed by `XXXX-XXXX-`)**; the raw value is never
persisted. Parts 4/7 spec the one-time-use encrypted capture path
if full Aadhaar is ever legally required (default: not captured).

Indexes: `village_id`, `school_id`, `(village_id, graduated_at)`.

#### 4.3.4 Events & activities

**`event`** — program events (AC, Special, …) with a `kind` flag
so "Tag Event" vs "Tag Activity" in §3.4 can both come from one
table.
- `id`, `uuid`, `name`, `kind TEXT NOT NULL CHECK (kind IN
   ('event','activity'))`, `description`, *audit*.
- `event.kind = 'event'` for AC / Special Event.
- `event.kind = 'activity'` for Board Games, Running Race, Kho-Kho,
  Kabaddi, Prakriti Prem, Dhan Kaushal, Jal Vriddhi,
  No Activity — Raining, No Activity — Training, …

Rationale for merging `event` + `activity`: the only UI difference
is the picker label; the data shape is identical. Keeps media and
attendance FKs uniform.

#### 4.3.5 Attendance

**`attendance_session`** — one row per (village, date, event).
- `id`, `uuid`
- `village_id` FK, `event_id` FK, `date INTEGER NOT NULL`
  (epoch-seconds midnight UTC).
- `start_time INTEGER NOT NULL`, `end_time INTEGER NOT NULL`.
- `voice_note_media_id INTEGER REFERENCES media(id)`
- *audit columns*
- `UNIQUE (village_id, date, event_id)` so re-submissions replace.

**`attendance_mark`** — one row per student per session.
- `id`
- `session_id` FK, `student_id` FK,
  `present INTEGER NOT NULL CHECK (present IN (0,1))`
- `UNIQUE (session_id, student_id)`
- `created_at`, `created_by` only (no update-in-place; a
  re-submission replaces the whole session's marks transactionally).

#### 4.3.6 Achievements

**`achievement`**
- `id`, `uuid`
- `student_id` FK, `description TEXT NOT NULL` (≤ 500 chars),
  `date INTEGER NOT NULL`.
- `type TEXT NOT NULL CHECK (type IN ('som','gold','silver'))`.
- `gold_count INTEGER`, `silver_count INTEGER` (only set when
  `type = 'gold'` or `type = 'silver'`; enforced by CHECK).
- *audit columns*
- Partial unique index to enforce "one SoM per student per month":
  `CREATE UNIQUE INDEX uq_som_per_month ON achievement
   (student_id, strftime('%Y-%m', date, 'unixepoch'))
   WHERE type = 'som' AND deleted_at IS NULL;`

#### 4.3.7 Media

**`media`** — single table for images, videos, and audio voice
notes. Replaces four vendor tables.
- `id`, `uuid`
- `kind TEXT NOT NULL CHECK (kind IN ('image','video','audio'))`
- `r2_key TEXT NOT NULL UNIQUE` — R2 object key; media payload
  lives in R2, never in D1.
- `mime TEXT NOT NULL`, `bytes INTEGER NOT NULL`
- `captured_at INTEGER NOT NULL`,
  `received_at INTEGER NOT NULL`
- `latitude REAL`, `longitude REAL` — from EXIF / geolocation
- `village_id INTEGER REFERENCES village(id)` — attributed
  village (AF picks at upload time per §3.4).
- `tag_event_id INTEGER REFERENCES event(id)` — nullable for
  pure voice-note media attached to attendance.
- *audit columns* (creator is the uploader)

Indexes: `(village_id, captured_at)`, `tag_event_id`,
`(kind, deleted_at)`.

#### 4.3.8 Content & settings

**`notice`** — formerly `notification`.
- `id`, `uuid`, `title`, `body`,
  `scope_level TEXT` / `scope_id INTEGER` (same semantics as
  `user.scope_*`; null scope_id + `scope_level='global'` = all
  users).
- `published_at INTEGER`, `expires_at INTEGER`
- *audit columns*

**`reference_link`** — curated external links.
- `id`, `uuid`, `title`, `url`, `description`, `category`,
  *audit*.

**`quick_link`** — phone/video quick actions merged.
- `id`, `uuid`, `kind TEXT CHECK (kind IN ('phone','video'))`,
  `label`, `target TEXT` (phone number or video URL),
  `role TEXT` (for phone: role of the contact), *audit*.

**`about_us`** — singleton, versioned.
- `id`, `body TEXT NOT NULL`, *audit*. Super Admin writes a new
  row; clients fetch the latest non-deleted row.

**`app_settings`** — single-row config (renamed from `vmr_settings`).
- `id INTEGER PRIMARY KEY CHECK (id = 1)`
- `media_retention_days INTEGER NOT NULL DEFAULT 180`
- `session_ttl_minutes INTEGER NOT NULL DEFAULT 720`
- `otp_ttl_minutes INTEGER NOT NULL DEFAULT 10`
- `otp_max_per_hour INTEGER NOT NULL DEFAULT 3`
- `default_language TEXT NOT NULL DEFAULT 'en'`
- *audit columns*

#### 4.3.9 Audit

**`audit_log`** — append-only (§9.4).
- `id`, `uuid`
- `occurred_at INTEGER NOT NULL`
- `actor_user_id INTEGER REFERENCES user(id)` — nullable for
  failed-login attempts where identity is unverified.
- `action TEXT NOT NULL` — e.g. `login.success`, `login.fail`,
  `login.locked`, `password.change`, `otp.request`, `otp.verify`,
  `user.create`, `user.role_change`, `settings.update`,
  `export.dashboard`.
- `target_type TEXT`, `target_id INTEGER` — nullable; the affected
  row when applicable.
- `metadata_json TEXT` — small JSON blob for action-specific
  context (IP, user-agent hash, prior/new values for role change).
- No update, no delete. Partitioned by year at query time via
  `occurred_at`.

### 4.4 Summary

- **22 tables** in the bespoke schema (vendor had 35).
- Removed: `ngo_features`, `role_permission`, `teacher_roles`,
  `teacher_roles_assign`, `country`, `territory`, `taluk`,
  `MembershipType`, `village_pgm_status`, `student_pgm_status`,
  `teacher_pgm_status`, `eventsNew`, `attendanceOffline`,
  `event_image_offline`, `event_video_offline`.
- Merged: `teacher` + `login_user_data` → `user`;
  `event_image` + `event_video` (+ offline pairs) → `media`;
  `quickPhoneLinks` + `quickVideoLinks` → `quick_link`.
- Added: `audit_log`.

### 4.5 Open items

- [ ] Confirm `territory` / `taluk` drop with migration dry-run
      (count rows in source).
- [ ] Confirm `MembershipType` drop — is there more than one value
      in production data?
- [ ] Decide whether to keep `school.type` as a CHECK enum or as a
      lookup table (depends on how often admins add new types).
- [ ] Confirm Aadhaar masking policy with legal: last 4 only, or
      encrypted-at-rest with BYOK?

---

## 5. API surface

Workers expose a **REST-over-JSON** API under `/api/*` and
`/auth/*`. The vendor's 286 Struts operations collapse to **~30
routes**. This is a bespoke-only simplification; we do not need the
`Check*`, `SystemUpdate*`, `getSingle*` family because REST verbs
already cover existence, bulk reactivate, and single-resource
fetches.

### 5.1 Conventions

- **Base URL**: `https://api.navsahyog.org/` (prod),
  `https://api.staging.navsahyog.org/` (staging).
- **Auth**: all `/api/*` routes require a session cookie or
  `Authorization: Bearer <token>`. `/auth/*` routes are
  unauthenticated except `/auth/logout` and `/auth/change-password`.
- **Scope enforcement**: every route derives the caller's
  `(role, scope_level, scope_id)` from the session and enforces it
  server-side. Query parameters narrow within scope; they cannot
  broaden it.
- **Resource IDs in URLs use `uuid`**, not rowid. This keeps IDs
  stable across environments and matches the outbox idempotency
  key (§6).
- **Pagination**: cursor-based. `?limit=50&cursor=<opaque>`. Max
  `limit` = 200. Responses include `next_cursor` (null when done).
- **Errors**: JSON `{ "error": { "code": "…", "message": "…",
  "details": … } }`. Standard codes: `unauthenticated`,
  `forbidden`, `not_found`, `conflict`, `validation`,
  `rate_limited`, `internal`.
- **Idempotency**: every POST/PATCH accepts an
  `Idempotency-Key` header; the Worker records it in KV for 24 h
  and replays the prior response on retry. Required for offline
  outbox (§6).
- **Content type**: `application/json` only. Media uploads use
  presigned R2 URLs (§5.8), not multipart through the Worker.

### 5.2 Authentication — `/auth/*`

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | Body `{ user_id, password }`. Returns session token + user profile. Increments `failed_login_count` on failure; locks account at 3. |
| `POST` | `/auth/change-password` | Authenticated. Body `{ old_password, new_password }`. Rejects re-entering `TEST*1234` (§3.1.2). Clears all other sessions. |
| `POST` | `/auth/otp/request` | Body `{ user_id, channel: 'email' \| 'sms' }`. Rate-limited per `app_settings.otp_max_per_hour`. |
| `POST` | `/auth/otp/verify` | Body `{ user_id, code }`. Returns a short-lived `password_reset_token`. |
| `POST` | `/auth/password-reset` | Body `{ password_reset_token, new_password }`. Unlocks and clears all sessions. |
| `POST` | `/auth/logout` | Deletes the KV session. |
| `GET`  | `/auth/me` | Returns the current user profile. |

### 5.3 Geography — `/api/geo/*`

All GETs are scope-filtered. POST/PATCH/DELETE require
`cluster_admin` or higher, each scoped to their own level or
below.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/geo/zones` | List. |
| `GET` | `/api/geo/states?zone=<uuid>` | List within scope. |
| `GET` | `/api/geo/regions?state=<uuid>` | |
| `GET` | `/api/geo/districts?region=<uuid>` | |
| `GET` | `/api/geo/clusters?district=<uuid>` | |
| `GET` | `/api/geo/villages?cluster=<uuid>` | Includes coordinates, pincode, program window. |
| `POST` / `PATCH` / `DELETE` | `/api/geo/{level}/…` | Same shape for each level (`zones`, `states`, `regions`, `districts`, `clusters`, `villages`). Soft delete only. |
| `POST` | `/api/geo/villages/:uuid/set-coordinates` | Replaces the vendor's `UpdateVillageCoordinates`. Body `{ latitude, longitude, altitude?, radius_m? }`. |

### 5.4 Users & roles — `/api/users`

Requires `cluster_admin` or higher (Super Admin for role changes).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/users?role=&scope_level=&scope_id=&q=` | Scope-filtered. |
| `POST` | `/api/users` | Create user. Auto-generates `user_id` or accepts one. Sets default password. |
| `GET` | `/api/users/:uuid` | |
| `PATCH` | `/api/users/:uuid` | Update profile fields. Role / scope changes are Super-Admin-only and emit `audit_log.user.role_change`. |
| `POST` | `/api/users/:uuid/unlock` | Resets `failed_login_count` and `locked_at`. |
| `POST` | `/api/users/:uuid/reset-password` | Sets `password_is_default = 1` and a fresh default. |
| `DELETE` | `/api/users/:uuid` | Soft delete + sets `left_at`. |

### 5.5 Schools — `/api/schools`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/schools?village=<uuid>` | |
| `POST` / `PATCH` / `DELETE` | `/api/schools[/:uuid]` | Standard CRUD, soft delete. |

### 5.6 Students — `/api/children`

Uses the vendor's user-facing term "children" in the URL for
clarity; the table is still `student` (§4.3.3).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/children?village=<uuid>&include_graduated=false&q=` | Scope-filtered. Default excludes graduated. |
| `POST` | `/api/children` | Create. Server rejects any `aadhaar` field (§9.1). |
| `GET` | `/api/children/:uuid` | |
| `PATCH` | `/api/children/:uuid` | Update profile / parent fields. |
| `POST` | `/api/children/:uuid/graduate` | Body `{ date, reason }`. Sets `graduated_at` and removes from active lists. |
| `DELETE` | `/api/children/:uuid` | Soft delete (rare; graduation is the normal path). |

### 5.7 Events, activities, qualifications — `/api/events`, `/api/activities`, `/api/qualifications`

Events and activities share the `event` table (§4.3.4) but are
surfaced as two endpoints for UI clarity.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/events` | `event.kind = 'event'`. |
| `GET` | `/api/activities` | `event.kind = 'activity'`. |
| `POST` / `PATCH` / `DELETE` | `/api/events[/:uuid]` | Admin. |
| `POST` / `PATCH` / `DELETE` | `/api/activities[/:uuid]` | Admin. |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/qualifications[/:uuid]` | |

### 5.8 Media — `/api/media/*`

Two-step upload: **presign → direct PUT to R2 → commit metadata**.
The Worker never proxies media bytes.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/media/presign` | Body `{ kind, mime, bytes }`. Returns `{ uuid, r2_key, upload_url, expires_at }`. Expiry ≤ 15 min. |
| `POST` | `/api/media` | Commit after successful PUT. Body `{ uuid, kind, r2_key, mime, bytes, captured_at, latitude, longitude, village_id, tag_event_id }`. |
| `GET` | `/api/media?village=<uuid>&kind=&from=&to=` | List + R2 presigned GET URLs (short TTL). |
| `GET` | `/api/media/:uuid` | Single, with fresh presigned GET URL. |
| `DELETE` | `/api/media/:uuid` | Soft delete in DB; actual R2 object deleted by retention cron (§9.3). |

The vendor's `UploadSingleImage` / `UploadSingleVideo` /
`fileuploadInfo` collapse into this pair. Large videos use multipart
(the presign endpoint returns a multipart init token when
`bytes > 10 MiB`).

### 5.9 Attendance — `/api/attendance`

Session-oriented: one POST writes the session and all marks
transactionally.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/attendance` | Body `{ village, date, event, start_time, end_time, voice_note_media?, marks: [{ student, present }] }`. Upserts on `(village, date, event)` and replaces marks. Returns the session with canonical IDs. |
| `GET` | `/api/attendance?village=&from=&to=` | List sessions + marks. Supports cluster-level scope. |
| `GET` | `/api/attendance/:uuid` | Single session with marks. |
| `DELETE` | `/api/attendance/:uuid` | Soft delete (Super Admin only). |

### 5.10 Achievements — `/api/achievements`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/achievements?village=&from=&to=&type=` | |
| `POST` | `/api/achievements` | Body `{ student, description, date, type, gold_count?, silver_count? }`. Validates type/medal invariants. Enforces "one SoM per student per month" (§4.3.6). |
| `GET` / `PATCH` / `DELETE` | `/api/achievements/:uuid` | |

### 5.11 Dashboards — `/api/dashboard/*`

Read-only, scope-filtered. Excel generation runs in the Worker and
streams an `.xlsx` response.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/dashboard/drilldown?metric=&level=&id=` | Metric ∈ `vc`, `af`, `children`, `attendance`, `achievements`. Returns rows for the next level below `(level, id)`. |
| `GET` | `/api/dashboard/drilldown.xlsx?…` | Same filters; XLSX download. |
| `GET` | `/api/dashboard/consolidated?cluster=&date=` | Single-day view. |
| `GET` | `/api/dashboard/consolidated?cluster=&from=&to=` | Range view. |
| `GET` | `/api/dashboard/consolidated.xlsx?…` | XLSX. |

Replaces the vendor's `getAttendanceStatusby{Level}`,
`ListDatewise…`, `ListRangewise…`, `ListClusterWiseStarOfMonth`,
`ClusterWiseStarOfPreviousMonth`, etc.

### 5.12 Content — `/api/notices`, `/api/reference-links`, `/api/quick-links`, `/api/about`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/notices?scope_level=&scope_id=&active=true` | Scope-resolved list. |
| `POST` / `PATCH` / `DELETE` | `/api/notices[/:uuid]` | Scope-gated. |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/reference-links[/:uuid]` | |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/quick-links[/:uuid]` | Combined phone + video. |
| `GET` | `/api/about` | Current version. |
| `POST` | `/api/about` | Super Admin — creates a new version. |

### 5.13 Settings — `/api/settings`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/settings` | Any authenticated user (for `default_language`, `media_retention_days` advisories on client). |
| `PATCH` | `/api/settings` | Super Admin. Writes `audit_log.settings.update` with before/after. |

### 5.14 Sync / outbox — `/api/sync/*`

Supports the offline outbox (§6). Full semantics in Part 4.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/sync/outbox` | Body `{ items: [{ idempotency_key, method, path, body }] }`. Applies each item in order, returning per-item results. Each item is equivalent to calling its `method path body` directly. |
| `GET` | `/api/sync/manifest?since=<epoch>` | Returns the list of records the client should pull for its scope since the given time (used by "Download Server Data"). |

### 5.15 Audit log — `/api/audit-log`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/audit-log?actor=&action=&from=&to=` | Super Admin only. |

### 5.16 Summary

Route count: **≈ 32** top-level paths (many supporting multiple
verbs). The vendor's 286 `operation:` codes collapse into these
because:

- `Insert* / Update* / Delete* / ListAll* / getSingle*` per entity
  → one REST collection + item per entity (×5 verbs folded into 3
  URLs).
- `Check*` (FK existence) → dropped. Clients use `GET /:uuid` and
  check 404; writes get a 409 on FK violation.
- `SystemUpdate*` (bulk reactivate) → dropped from the external
  API. Implemented as a Worker maintenance script when needed.
- `UploadSingleImage` / `UploadSingleVideo` / `fileuploadInfo` →
  `/api/media/presign` + `/api/media`.
- `getAttendanceStatusby*` / `ListDatewise…` / `ListRangewise…` /
  `ListClusterWiseStarOfMonth` / `ClusterWiseStarOfPreviousMonth`
  → `/api/dashboard/*` with query parameters.
- Struts `.do` endpoints (`mlogin`, `accountSetup`, …) → `/auth/*`.

### 5.17 Open items

- [ ] Confirm route prefix (`/api/` vs `/v1/`). Part 5 may pin this
      when Cloudflare Pages + Workers routing is nailed down.
- [ ] Decide whether to expose `/api/sync/manifest` as a single
      endpoint or per-resource (`/api/children?since=`, …). Single
      endpoint keeps the client simple; per-resource is easier to
      cache at the edge.
- [ ] Confirm whether District+ admins need any write endpoints at
      all, or if the §2.3 capability matrix (read-only) holds.

---

## 6. Offline & sync

The vendor app mirrors every write into a parallel `*Offline` table
in SQLite, then bulk-uploads. The bespoke app replaces that with a
**single outbox queue in IndexedDB**, drained through the sync
endpoints (§5.14). The schema never has twin tables — offline state
is purely a client concern.

### 6.1 Scope (what works offline)

Per §3.7, only three workflows run offline:

- Mark attendance (`POST /api/attendance`)
- Add achievement (`POST /api/achievements`)
- Capture image / video / voice note (media upload — §7)

Everything else (login, dashboards, master edits, graduation,
notices) requires online mode. Offline mode shows a banner and
disables those menu items.

Reads while offline are served from a **local cache** of the data
needed by these three workflows:

- Villages, schools, students (active only) in the user's scope.
- Events and activities (full picklists).
- The user's profile and role.

Cache is seeded on first online login and refreshed by
`/api/sync/manifest?since=…` on every subsequent online login.

### 6.2 Client storage layout (IndexedDB)

One IndexedDB database `navsahyog` with these object stores:

| Store | Key | Purpose |
|---|---|---|
| `session` | `'current'` | Current user profile, scope, language, `last_manifest_at`. |
| `cache_villages` | `uuid` | Scoped villages. |
| `cache_schools` | `uuid` | |
| `cache_students` | `uuid` | Active students (non-graduated) for scope. |
| `cache_events` | `uuid` | Events + activities (merged, distinguished by `kind`). |
| `outbox` | `idempotency_key` | Pending mutations. |
| `media_blobs` | `idempotency_key` | Binary payloads for queued media (separate store so outbox rows stay small). |
| `audit` | auto | Local ring buffer of last 500 sync events for debugging (capped). |

Size budget: cache stores target ≤ 5 MiB combined; media_blobs
capped at 200 MiB with an LRU eviction that refuses *new* captures
above the cap and surfaces an error banner (never silently drops).

Eviction never touches items in `outbox` until they're successfully
delivered.

### 6.3 Outbox row shape

```jsonc
{
  "idempotency_key": "01HXX…",       // ULID, generated client-side
  "created_at": 1713500000,           // epoch seconds
  "method": "POST",
  "path": "/api/attendance",
  "body": { /* the request body */ },
  "media_ref": "01HYY…",              // optional FK to media_blobs
  "attempts": 0,
  "last_error": null,
  "status": "pending"                 // pending | in_flight | done | failed
}
```

- **`idempotency_key`** is a ULID so rows sort by creation time
  naturally and it doubles as the `Idempotency-Key` header for the
  Worker (§5.1). The server dedupes by this key for 24 hours.
- **`body` never references server IDs** for records that were
  created offline — it references *other* `idempotency_key` values
  (e.g. an achievement queued for a child added while offline
  references the pending child's key). The sync runner resolves
  those to canonical UUIDs as it drains the queue.

### 6.4 Queueing rules

1. **All three offline-allowed write workflows enqueue unconditionally.**
   Online state is irrelevant at write time; the sync runner
   decides when to drain. This keeps behaviour identical online
   and offline — no separate code path.
2. **Each mutation is a single outbox row.** Attendance with N
   marks is *one* row that hits `POST /api/attendance` with the
   full marks array. (Matches §5.9's transactional semantics.)
3. **Media capture enqueues two things:**
   a. A `media_blobs` entry with the raw file.
   b. An `outbox` row with `method: "POST"`, `path: "/api/media"`,
      `body` containing the metadata, and `media_ref` pointing at
      the blob. The runner handles the R2 presign + PUT before
      submitting the metadata commit (§7.3).
4. **Duplicates are the client's problem.** If a user taps submit
   twice, the UI layer rejects the second tap (disabled button
   until outbox accepts); the outbox itself never enqueues two
   rows for the same logical action.

### 6.5 Sync runner

A Service Worker owns the runner. It runs when any of the
following fires:

- App start (if online).
- `online` window event.
- Periodic Background Sync (`navigator.serviceWorker.sync`,
  every 15 min when permitted).
- Manual trigger from the **Upload Offline Data** screen (§3.7).

Algorithm (single-threaded per device):

```text
while (outbox.has(pending or failed_with_retry_budget)):
    row = outbox.oldest_by_created_at()
    mark row.in_flight
    resolve placeholder refs in row.body
    if row.media_ref:
        if not uploaded_to_r2(row.media_ref):
            presign, PUT blob to R2
            mark blob uploaded
    response = fetch(row.method, row.path, row.body,
                     headers={Idempotency-Key: row.key})
    if response.ok:
        store canonical uuid(s) in a local ref-map
        mark row.done
        delete blob if any
    elif response.status in retryable():
        row.attempts++
        row.last_error = summary
        if row.attempts >= 5: mark row.failed
        else: mark row.pending with backoff(2**attempts seconds)
    else:
        mark row.failed with server error
```

Backoff schedule: 1s, 5s, 30s, 2m, 10m. Cap at 5 attempts, then
**require explicit user retry** (banner + per-item retry button in
§3.7's outbox screen).

### 6.6 Conflict resolution

- **Attendance** is idempotent by `(village, date, event)` per §5.9.
  A later offline submission for the same key *replaces* the
  earlier one; the server stamps `updated_at/by` and the client's
  outbox just records success.
- **Achievements** use the per-student partial unique index
  (§4.3.6, "one SoM per student per month"). A duplicate SoM
  submission returns 409; the runner surfaces it as a per-item
  error in §3.7's screen and offers **"overwrite server"** (which
  re-submits with a `force=true` flag — Super-Admin-only) or
  **"discard local"**.
- **Media** is never a conflict — each capture is a new object
  with a fresh UUID.
- **Student creation offline** is allowed. If the server rejects
  on validation (e.g. duplicate name + DOB + village + parent
  phone), the item goes to `failed` and the user resolves in the
  outbox screen.

### 6.7 Clock skew

- The client stamps **`captured_at`** in outbox rows and media.
- The server stamps **`received_at`** on commit.
- Dashboards and exports use `captured_at` by default and
  `received_at` as a tie-breaker.
- If `captured_at` is more than 7 days in the future relative to
  the server clock, the commit is rejected as `validation` — the
  client resolves by prompting the user to fix the device clock.

### 6.8 Security of offline cache

- `cache_*` stores are plain (no sensitive PII beyond what the
  user already sees in-app).
- **`outbox` and `media_blobs`** are encrypted at rest using a
  device-bound key:
  - Key derived via `crypto.subtle.deriveKey` from a per-device
    secret (first generated at install time, stored in
    `IndexedDB[session].device_secret`).
  - AES-GCM per row; the blob store stores a per-blob IV next to
    the ciphertext.
  - Password is *not* used as key material (would lock the user
    out of queued work on password change).
- On logout, all stores are wiped.
- On forced password change (§3.1.2), only the `session` store is
  cleared; the outbox is preserved so queued work survives the
  reset.

### 6.9 Manifest pull

`GET /api/sync/manifest?since=<epoch>` returns, per §5.14:

```jsonc
{
  "server_time": 1713500000,
  "villages":   { "upserts": [...], "tombstones": ["uuid", ...] },
  "schools":    { "upserts": [...], "tombstones": [...] },
  "students":   { "upserts": [...], "tombstones": [...] },
  "events":     { "upserts": [...], "tombstones": [...] }
}
```

Client applies upserts (INSERT OR REPLACE by uuid), removes
tombstoned rows, and writes `server_time` into `session.last_manifest_at`.

On first sync (`since=0`), payloads can be large. The endpoint
supports gzip + `Range` headers; Workers Cache stores the full
response keyed by `(scope_hash, since=0)` with a 5-minute TTL so a
training session of 50 field staff hitting it simultaneously warms
once.

### 6.10 Capacity & performance targets

- **Offline dwell**: 7 days on-device without sync, assuming
  typical usage (1 attendance + ~5 captures + 1 achievement per
  day per VC) fits comfortably in the 200 MiB media cap.
- **Drain time** on a healthy 3G link: one day of backlog (say 6
  items, ~50 MiB of video) drains in ≤ 3 minutes end-to-end.
- **Initial seed**: manifest response for a typical cluster (≤ 500
  students, ≤ 30 villages) is ≤ 500 KiB gzipped.
- **Sync runner overhead**: ≤ 1 % battery per hour when idle
  (runner only wakes on the triggers in §6.5).

### 6.11 Observability

Every sync run writes a compact record to the local `audit` store
and, when online, POSTs a batched `sync.report` event to
`/api/audit-log` (as an `internal` action, throttled to 1 per
hour). Fields: items drained, items failed, bytes uploaded, total
wall time, oldest pending item age.

### 6.12 Acceptance criteria (cross-section)

- A VC with no connectivity for 72 h can take daily attendance,
  add achievements, and capture media, then on reconnect drain
  the queue with zero data loss.
- Closing the app or rebooting the device does not lose queued
  items or in-flight uploads.
- The same attendance session submitted offline then again online
  results in **one** server-side record, not two.
- An SoM achievement queued offline for a student who is later
  graduated (online) still applies, provided the achievement
  date is ≤ graduation date.
- A second device logged in as the same user sees queued items
  from the first device only after they sync; the outbox is
  device-local.

### 6.13 Open items

- [ ] Decide whether offline student-creation is permitted (§6.6
      assumes yes). Field practice may prefer forcing online for
      child registration to validate Aadhaar-free parent data in
      real time.
- [ ] Pick manifest granularity: full-scope vs per-resource
      (also flagged in §5.17).
- [ ] Confirm device-bound key storage is acceptable for
      NSNOP/legal — alternative is key in password-derived form,
      which loses data on password reset.

---

### 9.1 NSNOP — child data
- **Do not collect child Aadhaar.** The vendor schema has
  `student.aadhaarNo`; the bespoke schema **removes it from both UI
  and D1**. Migration drops any data present in that column.
- Child PII stored: first name, last name, gender, DOB, school,
  village, photo, program join date, optional graduation date/reason.
- No medical, caste, religion, or income fields.

### 9.2 Parent data
- Parent Aadhaar is collected but **masked in the UI** (last 4 digits
  only) and access-logged. Not included in routine exports.
- Phone numbers validated as Indian (`+91` optional prefix, 10 digits).
  Smartphone flag is informational only.
- Alternate contact requires a relationship label.

### 9.3 Data retention
- Media retention is configurable per type (`vmr_settings.MaxDays`).
  A Worker cron deletes R2 objects past the threshold and marks the
  DB row `deleted_at`.
- Student records are retained for the duration of the program plus
  a configurable grace period (default: 2 years after graduation).
- Audit-log retention: 7 years (confirm with stakeholder).

### 9.4 Audit trail
- Every write stamps `created_by/at`, `updated_by/at`,
  `deleted_by/at` (soft delete).
- Append-only `audit_log` table records: login, password change,
  OTP issue/verify, failed login, user create / role change,
  retention-setting change, data export.
- Readable only by Super Admin.

### 9.5 Security baseline
- HTTPS only (Cloudflare-enforced).
- Passwords hashed with Argon2id in the Worker.
- R2 presigned URLs are scoped to a single object and expire in
  ≤ 15 minutes.
- **Rotate the Google Maps API key** (currently baked into
  `index.html` in the vendor APK) before any public release.
- No third-party analytics; use Cloudflare Web Analytics.

### 9.6 Open items for stakeholder confirmation
- [ ] Which languages are actually in field use?
- [ ] Are `Territory` and `Taluk` geo levels populated in production
      data?
- [ ] Audit-log retention period.
- [ ] iOS required at launch, or Android + PWA only?
- [ ] Play Store APK distribution required, or is PWA install enough
      for field staff?
- [ ] Exact AF → Cluster relationship (is an AF always 1:1 with a
      cluster, or can one AF cover parts of multiple clusters?).
