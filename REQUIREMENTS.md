# NavSahyog ERP — Requirements

Status: **draft, in progress**. Written in 5 parts (see `HANDOFF.md`).
This commit adds Section 10 (Part 5a). Section numbers below are
stable; gaps are filled by later parts.

## Table of contents
1. Overview & goals ✅
2. Users & roles ✅
3. Functional requirements ✅
4. Data model ✅
5. API surface ✅
6. Offline & sync ✅
7. Media handling ✅
8. Non-functional ✅
9. Compliance ✅
10. Migration ✅
11. Cloudflare mapping — *Part 5b*

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

## 7. Media handling

All images, videos, and voice notes live in **R2**. D1 stores only
the metadata row (`media`, §4.3.7). The Worker never proxies bytes
— clients PUT directly to R2 using presigned URLs (§5.8).

### 7.1 R2 bucket layout

Two buckets per environment:

- **`media-prod`** — canonical storage for committed media.
- **`media-staging`** — mirror for the staging environment.

Object key convention (stable; survives row deletes):

```
{kind}/{yyyy}/{mm}/{dd}/{village_uuid}/{media_uuid}.{ext}
```

e.g. `image/2026/04/19/0194…/01HXX…ULID.jpg`.

Rationale:
- Date prefix keeps R2 listings cheap for retention sweeps.
- Village prefix aids reporting and any future per-village ACLs.
- `media_uuid` is the same ULID used as `idempotency_key` in the
  outbox (§6.3), so the key is deterministic from the client side
  without a round-trip.

### 7.2 Accepted types and size limits

| Kind | MIME | Client cap | Notes |
|---|---|---|---|
| image | `image/jpeg`, `image/png`, `image/webp` | 8 MiB raw | Re-encoded to WebP on device before upload if > 2 MiB. |
| video | `video/mp4` (H.264 + AAC) | 200 MiB raw | Mandatory transcode on device to 720p / ≤ 2 Mbps if source > 50 MiB. |
| audio | `audio/mp4` (AAC) or `audio/ogg` (Opus) | 16 MiB raw | Voice notes only; max duration 5 min (client-enforced). |

The Worker rejects commits (§5.8) with a 413 when
`bytes > app_settings.media_bytes_limit[kind]`; the client
pre-validates to avoid wasted uploads.

### 7.3 Upload pipeline

1. **Capture** → client computes SHA-256 of the file.
2. **Client transcode / compress** per §7.2. EXIF GPS is
   **preserved** for images; for videos and audio, the client
   writes a `com.navsahyog.gps` sidecar string containing
   `lat,lng,captured_at` into the container metadata (MP4 `©xyz`
   / Matroska tag) *and* sends the values in the `POST /api/media`
   body. Server trusts the body; the sidecar is a forensics
   backup.
3. **Presign** (`POST /api/media/presign`, §5.8) with the chosen
   `r2_key` and content hash. The Worker validates:
   - Kind matches the user's allowed list.
   - Caller has write scope on `village_id`.
   - Bytes within the configured cap.
4. **Direct PUT** from the client to R2 using the presigned URL.
   - Objects ≤ 10 MiB: single PUT.
   - Objects > 10 MiB: R2 multipart. The presign response returns
     `{ upload_id, part_urls: [...] }` pre-signed for 6 parts by
     default; additional parts are obtained via
     `POST /api/media/presign/parts` with the `upload_id`.
5. **Commit** (`POST /api/media`) with the final size and ETag.
   The Worker:
   - Verifies the object exists in R2 (`HEAD`) and matches the
     size/ETag from the commit body.
   - Writes the `media` row.
   - Enqueues a **`media.derive`** job on Queues for thumbnail
     generation (§7.4).
6. On client side, outbox row (§6.3) is marked `done` and the
   local blob is deleted.

### 7.4 Derived renditions

A Worker consumer on the **`media-derive`** queue generates:

- **Image thumbnails**: 256px and 1024px WebP, stored as
  `derived/thumb-256/{original_key}` and `derived/thumb-1024/…`.
  Uses Cloudflare Images binding in production (with a fall-back
  Worker that wraps `wasm-vips` for local dev).
- **Video posters**: single JPEG frame at `t=1s`, saved as
  `derived/poster/{original_key}.jpg`.
- **Audio**: no derived form; served as-is.

Failures are retried 3× with exponential backoff, then recorded
on the `media` row as `derive_failed_at` and surfaced in the
Super Admin dashboard for manual retry. The original is never
blocked by a derivation failure.

### 7.5 Delivery to clients

Reads return short-lived presigned GET URLs. Two URL flavours:

- **`url`** — original object, 15-minute TTL. Used when the user
  explicitly opens media detail.
- **`thumb_url`** — 256px WebP, 1-hour TTL. Used in list views.

Dashboards and list endpoints return only `thumb_url` to keep
payload small.

Static caching: Cloudflare Cache edges cache thumbnails by URL
for 1 hour; the TTL of the presigned URL itself is the cache
ceiling. Cache purge on delete is best-effort.

### 7.6 EXIF GPS rules

- On capture, the client prefers EXIF GPS embedded in the source
  file. If absent or stale (> 10 min old), it falls back to
  `navigator.geolocation` with `enableHighAccuracy: true`.
- The captured lat/lng is stored in **three places**:
  1. `media.latitude` / `media.longitude` in D1.
  2. The file's EXIF (images) or container metadata
     (videos/audio).
  3. The outbox row body (provenance chain for offline captures).
- If the source file lacked EXIF GPS and geolocation fails, the
  client warns the user and either records a null location
  (permitted, flagged in §7.8) or the user retakes.
- Village geofence check (optional): when `village.radius_m` is
  set, the server warns (non-blocking) if GPS is > radius from
  the village centroid, stamping `media.geo_warning = 1`.

### 7.7 Retention

- The value lives in `app_settings.media_retention_days` (default
  180).
- A daily Worker cron (`media-retention`) sweeps R2 for objects
  older than the threshold (using the `yyyy/mm/dd` prefix for
  efficient listing), deletes them, and sets `deleted_at` on the
  corresponding `media` rows.
- Derived renditions are deleted together with the original.
- Deletions are logged to `audit_log` as a single
  `media.retention_sweep` event per day with a count.
- A Super Admin can **pin** specific media (field
  `media.retained_until`) to override the retention sweep — used
  for legal holds and showcase media.

### 7.8 Acceptance criteria

- A 5-minute 1080p capture on a mid-range Android phone is
  transcoded to ≤ 75 MiB H.264 720p in ≤ 2× real time and
  uploads over 3G in ≤ 5 min.
- The total bytes pushed through the Worker for a media upload
  is ≤ 2 KiB per item (only metadata; bytes go direct to R2).
- A media row with a derivation failure still serves the original
  via `url`; the thumbnail slot gracefully falls back to a
  placeholder in the UI.
- Deleting a `media` row removes the original, all derived
  renditions, and any cached thumbnails within 24 hours.
- A presigned URL leaked to a third party expires within 15 min
  (for originals) / 60 min (for thumbnails).

### 7.9 Open items

- [ ] Is permitting null-GPS captures acceptable, or must every
      upload carry coordinates?
- [ ] Pick the thumbnail generator: Cloudflare Images (paid, per
      transformation) vs in-Worker `wasm-vips` (free, CPU time).
- [ ] Confirm video max length — 5 min is a guess; longer films
      may need chunked uploads per scene.
- [ ] Decide retention default: 180 days matches the vendor's
      default `vmr_settings.MaxDays`; NavSahyog may want longer
      for legal/showcase archives (consider the `retained_until`
      pin in §7.7 as the escape hatch).

---

## 8. Non-functional requirements

Security and audit fundamentals live in §9. This section covers
everything else: i18n, low-bandwidth / rural, session and OTP,
observability, reliability, accessibility, and browser support.

### 8.1 Internationalisation (i18n)

- **Default set at launch**: `en`, `kn` (Kannada), `ta` (Tamil).
  Subject to §9.6 confirmation.
- **Candidate additions** from the vendor app, gated on actual
  field use: `hi`, `ml` (Malayalam), `te` (Telugu).
- **Language source of truth**: JSON resource bundles shipped with
  the SPA (`/locales/{lang}/common.json`, one per feature area).
  No runtime language editor — changes ship via deploy.
- **Persistence**: user's chosen language is stored in `session`
  (IndexedDB §6.2) and echoed on the server as
  `user.preferred_language` for OTP / notice delivery.
- **String externalisation rule**: no user-facing string ever
  lives in component code. Enforced by a lint rule
  (`eslint-plugin-i18next/no-literal-string`) and a CI grep for
  literal strings in JSX/TSX.
- **Number / date / currency**: `Intl.*` only; no hand-rolled
  formatters.
- **Font coverage**: one variable font that covers Latin +
  Devanagari + Kannada + Tamil + Telugu + Malayalam glyphs
  (e.g. Noto Sans composite) to keep SPA bundle < one font asset.
- **Right-to-left**: not needed (no RTL languages in scope).

### 8.2 Low-bandwidth & rural

Aggressive budgets because field users are on 2G/3G edges.

| Budget | Target | Enforced by |
|---|---|---|
| JS (first load) | ≤ 180 KiB gzipped | CI bundle-size check (`size-limit`) |
| CSS (first load) | ≤ 20 KiB gzipped | same |
| HTML shell | ≤ 8 KiB gzipped | same |
| Font subset (first load) | one WOFF2 ≤ 80 KiB | CI |
| JSON payload (list endpoints, typical) | ≤ 64 KiB gzipped | Load test |
| Image in list view | ≤ 12 KiB (thumbnail) | §7.4 |
| Video in list view | poster only; no autoplay | §7.4 |

Techniques:

- **Compression**: Cloudflare brotli/gzip on all text responses.
- **HTTP/3 QUIC** at the edge (default on Cloudflare) reduces
  handshake cost on flaky links.
- **Request deduplication**: client shares a single in-flight
  promise per URL within a session.
- **Stale-while-revalidate** caching for manifest (§6.9) and
  thumbnails (§7.5).
- **Chunked UI hydration**: route-level code splitting; only the
  current workflow's bundle loads.
- **Retry with jitter** for all network calls (exponential,
  full-jitter, cap 30 s).
- **Optimistic UI** where safe: children add (§3.2.2) renders
  immediately and rolls back on server error.
- **Battery**: Service Worker periodic sync capped at 15-minute
  intervals (§6.5); no always-on background work.

Offline data plane: see §6 in full. Online-reads fall through to
the same IndexedDB cache so the UI is identical regardless of
connectivity.

### 8.3 Password policy

Minimum at launch:

- Length ≥ 8 characters.
- At least one uppercase, one digit, one symbol (`!@#$%^&*_-`).
- Not equal to `TEST*1234` (the vendor default) — forced change
  flow (§3.1.2) rejects re-entry.
- Not equal to one of the last 5 passwords (hashes stored in a
  small `user_password_history` side table, capped at 5 rows per
  user).
- Not present in a bundled top-10 000 common-password list
  (shipped as a Bloom filter in the Worker; < 16 KiB).

Hashing: **Argon2id**, parameters `t=2, m=19456 KiB, p=1`. Tuned
for Worker CPU-time limits; benchmarked at < 50 ms per hash.

Throttling: 3 failed logins lock the account (§3.1.1). Independent
IP-level throttle in KV (10 failed logins / 5 min / IP) protects
against user enumeration.

### 8.4 Session & token TTLs

| Token | Store | Default TTL | Configurable? |
|---|---|---|---|
| Session token (`/auth/login`) | KV namespace `sessions` | `app_settings.session_ttl_minutes` (720 = 12 h) | Yes |
| OTP code | KV namespace `otp` | `app_settings.otp_ttl_minutes` (10 min) | Yes |
| `password_reset_token` (§5.2) | KV namespace `otp` | 5 min (not configurable) | No |
| Presigned R2 URL (original) | R2 | 15 min | No |
| Presigned R2 URL (thumbnail) | R2 | 60 min | No |
| Idempotency replay | KV namespace `idem` | 24 h | No |

Cookie attributes for session token:
`HttpOnly; Secure; SameSite=Lax; Path=/; Domain=navsahyog.org`.
On logout, the cookie is cleared and the KV entry deleted.
On password change, all session KV entries for that user are
bulk-deleted.

### 8.5 Rate limits

Enforced in Workers via Cloudflare Rate Limiting rules (or KV
counters where fine-grained).

| Surface | Limit | Scope |
|---|---|---|
| `/auth/login` | 10 / min | per IP |
| `/auth/login` (failure) | 10 / 5 min | per user_id |
| `/auth/otp/request` | `app_settings.otp_max_per_hour` (3) | per user |
| `/auth/password-reset` | 5 / hour | per user |
| `/api/sync/outbox` | 60 / min | per session |
| `/api/media/presign` | 120 / min | per session |
| `/api/dashboard/*` | 30 / min | per session |
| Every other `/api/*` | 300 / min | per session |

A 429 response includes `Retry-After` and a JSON body
(`error.code = "rate_limited"`).

### 8.6 Audit trail (operational extension of §9.4)

§9.4 defines the `audit_log` schema and retention. For day-to-day
operations:

- Audit entries are written **synchronously** in the same
  transaction as the action they describe. A transaction that
  fails to write audit rolls the whole thing back.
- Audit writes for bulk actions (retention sweep, migration
  import) batch one entry per batch rather than one per row, with
  `metadata_json.count`.
- A nightly job checks `audit_log` for gaps in `id` sequences and
  alerts the Super Admin on Slack if any are found (tamper
  detection signal, not a guarantee).

### 8.7 Soft delete scope

Soft delete (`deleted_at` + `deleted_by`, §4.1) applies to:

- `user`, `student`, `school`, `village`, `cluster`, `district`,
  `region`, `state`, `zone`.
- `event`, `qualification`, `achievement`,
  `attendance_session`, `notice`, `reference_link`, `quick_link`.
- `media` (original deleted by retention cron — see §7.7).

Never soft-deleted (hard delete only):

- `attendance_mark` — replaced in-place per session (§4.3.5).
- `audit_log` — append-only; never modified.

Soft-deleted rows are excluded from every list endpoint by
default. A Super Admin tool (`GET /api/audit-log?action=delete…`)
can reverse a delete within 30 days by clearing `deleted_at`.

### 8.8 Observability

**Logs**:
- Workers Logpush to R2, partitioned daily. One bucket:
  `logs-prod`. Retention: 90 days (lifecycle rule on the bucket).
- No PII in log bodies. Authenticated requests log the user UUID
  and role; request bodies are logged only for 4xx/5xx responses,
  and only after PII fields (Aadhaar, phone, student name) are
  redacted by a Workers middleware.

**Metrics**:
- Workers Analytics Engine events, one dataset per feature
  (`attendance_submit`, `media_commit`, `sync_drain`, …). Fields:
  user UUID (hashed), cluster UUID, latency, status, payload size.
- Dashboards built in Grafana Cloud (free tier) consuming the
  Analytics Engine SQL API. No third-party RUM or analytics SDK
  in the client.

**Traces**:
- W3C `traceparent` generated at the edge and propagated through
  Workers → D1 → Queues. Sampled at 10 % by default; 100 % for
  requests whose session has `debug_trace = 1` (Super Admin
  toggle).

**Alerts** (Cloudflare Notifications → email + Slack):
- 5xx rate > 1 % over 5 min.
- D1 query error rate > 0.5 % over 15 min.
- Outbox drain failure rate > 10 % over 1 hour (from client
  `sync.report`, §6.11).
- R2 cron retention sweep missing for > 36 h.

### 8.9 Reliability & backup

- **D1**: daily automatic backup retained for 30 days. A weekly
  Worker also exports to R2 as `backups/d1/{yyyy-mm-dd}.sql.gz`
  with 1-year retention (Super Admin restore path; tested
  quarterly — see §10 dry-run).
- **R2**: media bucket has versioning disabled (cost) but the
  retention cron's delete is logged to `audit_log` with the
  object key, so recovery within 24 h is possible from R2's
  lifecycle-tombstone grace window.
- **KV**: session / OTP / idempotency are ephemeral; no backup
  needed.
- **RTO / RPO targets**: RTO 4 h, RPO 24 h. Higher frequencies
  are deferred until usage justifies cost.

### 8.10 Accessibility

- **WCAG 2.1 AA** for all authenticated screens.
- Minimum tap target 44×44 px.
- Contrast ratio ≥ 4.5:1 for text.
- All interactive controls reachable by keyboard and by screen
  reader (axe-core test in CI).
- Voice-note recording has a visible and keyboard-accessible
  stop button (the vendor app relies solely on tap).

### 8.11 Browser & device support

- Android Chrome and Android WebView from the last 3 stable
  versions (rolling).
- Desktop Chrome, Edge, Firefox, Safari — last 2 stable versions
  (for admin roles).
- iOS Safari is **best-effort** at launch (§1.3 non-goal); Part 5
  revisits once field usage data is in.
- Minimum device: 2 GB RAM Android 9; tested on the "field
  baseline" device list (to be enumerated in Part 5).

### 8.12 Versioning & compatibility

- API paths include no version segment at launch; breaking
  changes ship under a new path prefix (`/api/v2/…`) with a
  deprecation window ≥ 90 days. Non-breaking changes are the
  norm (additive JSON fields).
- The SPA and Workers are deployed together; the SPA sends its
  build hash in `X-Client-Build`. Workers reject incompatible
  builds (compat table in code) with a `409 client_outdated` that
  forces a refresh.
- D1 migrations are forward-only, checked in as numbered SQL
  files, run automatically on deploy.

### 8.13 SLOs

| Metric | Target |
|---|---|
| API availability (excluding D1 upstream) | 99.5 % monthly |
| API p50 latency (read, edge-warm) | ≤ 120 ms |
| API p95 latency (read) | ≤ 400 ms |
| API p95 latency (write) | ≤ 800 ms |
| Media commit to thumbnail-ready (p95) | ≤ 30 s |
| Outbox drain success rate (per day) | ≥ 98 % |

### 8.14 Open items

- [ ] Final language set for launch (mirrors §9.6).
- [ ] Field-baseline device list for §8.11.
- [ ] Confirm Grafana Cloud (or self-host on Workers Analytics
      dashboards) for §8.8.
- [ ] Confirm password-history depth (5) and top-common-password
      list size with stakeholder.
- [ ] Confirm alert channels (Slack channel / email list) and
      on-call rotation.

---

## 10. Migration

One-shot import from the vendor's production VMR backend
(`portal.viewmyrecords.com/vmr/`) into the bespoke D1 + R2 stack,
followed by a controlled dual-run cut-over. Zero data loss.

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
- Retention: migrated media inherit
  `app_settings.media_retention_days`. Super Admin can
  `retained_until`-pin showcase media during P7 before the first
  sweep.

**Content** — `aboutus`, `notification`, `referencelink`,
`quickPhoneLinks`, `quickVideoLinks`, `vmr_settings`:

- Drop `CorpId`; filter to NavSahyog.
- `quickPhoneLinks` + `quickVideoLinks` → `quick_link` with
  `kind`.
- `vmr_settings` → `app_settings` (single row); missing fields
  default per §4.3.8.

**Not migrated** (vendor artefacts without a target table):

- `ngo_features`, `role_permission`, `MembershipType`,
  `country`, `territory`, `taluk` (if unused),
  `village_pgm_status` (merged), `teacher_roles`,
  `teacher_roles_assign` (merged), `student_pgm_status` (merged),
  `teacher_pgm_status` (merged), `eventsNew` (deduped),
  all `*Offline` tables (merged with their canonical pairs).

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
5. Send a broadcast notification (§3.8.2) to all users: new app
   URL + login-first-time-with-same-user-id instructions.
6. Monitor dashboards (§8.8) for 4 hours at 100 % trace sampling.

### 10.9 Dual-run & decommission

- **Dual-run window**: 30 days. Vendor remains reachable as a
  read-only archive at a new URL
  (`archive.vmr.navsahyog.org`). New writes go only to the
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
| Field users confused by new login URL | Support burden spike | Broadcast notice + in-vendor-app banner for 30 days before cut-over; AF-led training refresh per cluster. |

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
