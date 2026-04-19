# NavSahyog ERP — Requirements

Status: **draft, in progress**. Written in 5 parts (see `HANDOFF.md`).
This commit covers Part 1. Section numbers below are stable; gaps are
filled by later parts.

## Table of contents
1. Overview & goals ✅
2. Users & roles ✅
3. Functional requirements — *Part 2*
4. Data model — *Part 3*
5. API surface — *Part 3*
6. Offline & sync — *Part 4*
7. Media handling — *Part 4*
8. Non-functional — *Part 4*
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

## 9. Compliance

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
