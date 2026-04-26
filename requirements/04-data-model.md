[← §3 Functional](./03-functional.md) · [Index](./README.md) · [§5 API surface →](./05-api-surface.md)

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
  (Super Admin path). Retention deletes happen out-of-system
  (see §9.3, decisions.md D1/D4).
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
| `aboutus` | **Drop** — decisions.md D15. §3.8.3 cancelled. |
| `notification` | **Drop** — decisions.md D15. §3.8.2 cancelled; broadcasts go out-of-band. |
| `referencelink` | **Drop** — decisions.md D15. §3.8.4 cancelled. |
| `quickPhoneLinks`, `quickVideoLinks` | **Drop** — decisions.md D15. §3.8.5 cancelled; quick actions go out-of-band. |
| `legacy_settings` | **Drop.** Retention out-of-system; other knobs are Worker env vars (decisions.md D1). |
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

#### 4.3.8 Content

**Cancelled — decisions.md D15.** The four content-hub tables
(`notice`, `reference_link`, `quick_link`, `about_us`) were
dropped together with §3.8.2–§3.8.6. Section number retained so
existing cross-references (§5.12, §8.4, etc.) still resolve.

**No `app_settings` table.** The vendor's `legacy_settings` has no
bespoke equivalent. Runtime tunables (session TTL, OTP TTL, default
language) live in Worker env vars; retention timelines are
handled out-of-system (see §9.3, decisions.md D1/D4).

##### 4.3.8.1 Training manuals (§3.8.8)

**`training_manual`** — read-only catalogue surfaced at
`/training-manuals` for every authenticated role; authored by
Super Admin from Master Creations.

- `id INTEGER PRIMARY KEY`
- `category TEXT NOT NULL` — free-form label used for grouping
  on the read page (e.g. `Onboarding`, `Attendance`).
- `name TEXT NOT NULL` — display label, also the link text.
- `link TEXT NOT NULL` — absolute `http(s)` URL; validated at
  the route layer. The asset itself is not hosted by the ERP.
- `created_at INTEGER NOT NULL`,
  `created_by INTEGER NOT NULL REFERENCES user(id)`,
  `updated_at INTEGER NOT NULL`,
  `updated_by INTEGER NOT NULL REFERENCES user(id)` —
  `updated_at` is surfaced on the read page so users can see
  when a manual last changed.
- `UNIQUE (category, name)` — same name is allowed across
  different categories.
- Index: `(category COLLATE NOCASE, name COLLATE NOCASE)` for
  the grouped sort on the read page.

Soft-delete is deferred (parity with the other L3.1 masters);
removing a row is a hard `DELETE`-from-admin operation when the
post-MVP slice lands.

#### 4.3.9 Audit

**`audit_log`** — append-only (§9.4).
- `id`, `uuid`
- `occurred_at INTEGER NOT NULL`
- `actor_user_id INTEGER REFERENCES user(id)` — nullable for
  failed-login attempts where identity is unverified.
- `action TEXT NOT NULL` — e.g. `login.success`, `login.fail`,
  `login.locked`, `password.change`, `otp.request`, `otp.verify`,
  `user.create`, `user.role_change`, `export.dashboard`.
- `target_type TEXT`, `target_id INTEGER` — nullable; the affected
  row when applicable.
- `metadata_json TEXT` — small JSON blob for action-specific
  context (IP, user-agent hash, prior/new values for role change).
- No update, no delete. Partitioned by year at query time via
  `occurred_at`.

### 4.4 Summary

- **18 tables** in the bespoke schema (vendor had 35).
- Removed: `ngo_features`, `role_permission`, `teacher_roles`,
  `teacher_roles_assign`, `country`, `territory`, `taluk`,
  `MembershipType`, `village_pgm_status`, `student_pgm_status`,
  `teacher_pgm_status`, `eventsNew`, `attendanceOffline`,
  `event_image_offline`, `event_video_offline`, `legacy_settings`
  (no bespoke equivalent — decisions.md D1), and the four
  content-hub tables `notification`, `aboutus`, `referencelink`,
  `quickPhoneLinks` + `quickVideoLinks` (§3.8.2–§3.8.5 cancelled —
  decisions.md D15).
- Merged: `teacher` + `login_user_data` → `user`;
  `event_image` + `event_video` (+ offline pairs) → `media`.
- Added: `audit_log`, `training_manual` (§4.3.8.1).

### 4.5 Open items

- [ ] Confirm `territory` / `taluk` drop with migration dry-run
      (count rows in source).
- [ ] Confirm `MembershipType` drop — is there more than one value
      in production data?
- [ ] Decide whether to keep `school.type` as a CHECK enum or as a
      lookup table (depends on how often admins add new types).
- [ ] Confirm Aadhaar masking policy with legal: last 4 only, or
      encrypted-at-rest with BYOK?

