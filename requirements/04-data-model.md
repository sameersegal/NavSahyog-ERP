[← §3 Functional](./03-functional.md) · [Index](./README.md) · [§5 API surface →](./05-api-surface.md)

---

## 4. Data model

Target: **D1 (SQLite)**. The vendor schema had 35 tables; the
bespoke schema is **21 tables** by dropping multi-tenancy, the
generic permission matrix, the duplicated "offline" twin tables,
vendor dedup artefacts, and unpopulated geo levels.

The authoritative DDL lives in `db/migrations/*.sql` — every
column, index, CHECK constraint, and FK is in code. `db/README.md`
indexes the migrations; the seed catalogue is `db/seed.sql`.

What follows is the narrative code can't carry: project-wide
conventions, and the vendor-to-bespoke drop / merge map that §10
cuts over against.

### 4.1 Conventions

- **IDs**: `INTEGER PRIMARY KEY` (SQLite rowid). External-facing
  resources also carry a `uuid TEXT UNIQUE NOT NULL` (generated in
  the Worker) for stable cross-environment references and outbox
  idempotency (§6).
- **Audit columns** on every write-heavy table:
  `created_at`, `created_by`, `updated_at`, `updated_by`,
  `deleted_at`, `deleted_by`. Timestamps are Unix epoch seconds.
- **Soft delete**: a non-null `deleted_at` hides the row from
  normal queries. Hard delete is reserved for GDPR-style erasure
  (Super Admin path). Retention deletes happen out-of-system
  (decisions.md D1, D4).
- **Scope columns**: tables that need scope filtering carry the
  lowest-applicable geo FK (`village_id`, `cluster_id`, …). Higher
  levels are derived by join.
- **Enums**: stored as short TEXT with a `CHECK` constraint, not a
  lookup table. Lookup tables only where the set is editable by
  admins at runtime.
- **No `CorpId`.** Single tenant (§1.3).
- **Aadhaar.** `student.aadhaar` is intentionally absent (§9.1).
  Parent Aadhaar, when collected at all, is stored only in the
  masked form (`XXXX-XXXX-####`) — the raw value is never
  persisted.
- **`scope_id` invariant.** `user.scope_id` is enforced in
  application code, not DB-level FK (the target table varies by
  `scope_level`). Tracked as U4 in review-findings-v1.

### 4.2 Drop / merge map (vendor → bespoke)

The migration target. §10 cuts over against this map.

| Vendor table(s) | Bespoke decision |
|---|---|
| `ngo_features` | **Drop.** Single-tenant; feature set hardcoded. |
| `role_permission` | **Drop.** Capabilities hardcoded in `packages/shared/src/capabilities.ts`. |
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
| `aboutus` | **Drop** — D15. §3.8.3 cancelled. |
| `notification` | **Drop** — D15. §3.8.2 cancelled; broadcasts go out-of-band. |
| `referencelink` | **Drop** — D15. §3.8.4 cancelled. |
| `quickPhoneLinks`, `quickVideoLinks` | **Drop** — D15. §3.8.5 cancelled; quick actions go out-of-band. |
| `legacy_settings` | **Drop.** Retention out-of-system; other knobs are Worker env vars (D1). |
| *(new)* | `audit_log` — append-only (§9.4). |
| *(new)* | `training_manual` — §3.8.8, L3.1.1. |
| *(new)* | `farmer`, `pond`, `pond_agreement_version` — §3.10 Jal Vriddhi (D25–D28). |

### 4.3 Tables

Per-table column lists previously inlined here moved to
`db/migrations/*.sql` (the authoritative source). Sub-section
numbers (§4.3.1 user, §4.3.2 geo, §4.3.5 attendance,
§4.3.6 achievement, §4.3.7 media, §4.3.8 audit_log,
§4.3.10 farmer/pond/pond_agreement_version) are retained as
stable anchors for cross-references in `decisions.md` and
`review-findings-v1.md`. Look up the corresponding
`*.sql` file for column-level detail.

### 4.4 Summary

Removed; the table count and rationale moved to the section intro.

### 4.5 Open items

- [ ] Confirm `territory` / `taluk` drop with migration dry-run
      (count rows in source).
- [ ] Confirm `MembershipType` drop — is there more than one value
      in production data?
- [ ] Decide whether to keep `school.type` as a CHECK enum or as a
      lookup table (depends on how often admins add new types).
- [ ] Confirm Aadhaar masking policy with legal: last 4 only, or
      encrypted-at-rest with BYOK?
