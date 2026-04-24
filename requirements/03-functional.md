[← §2 Users & roles](./02-users-and-roles.md) · [Index](./README.md) · [§4 Data model →](./04-data-model.md)

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
- Each level renders a table with the metric value and a **CSV
  download** button; tapping a row drills to the next level.
  (`.xlsx` is out; see decisions.md D2.)
- **Acceptance**: the leaf (village) level shows per-student detail
  for Children; per-session rows for Attendance; per-award rows for
  Achievements.

#### 3.6.2 Consolidated dashboard
- **Folded into §3.6.1** (decisions.md D12). Mechanics — scope
  picker, breadcrumb, drill, CSV, URL state — are §3.6.1's; this
  section describes only the metric pack and its behaviour.
- Date selector: **single day** or **range** (two date icons in
  the green header strip, per the onboarding doc). Shared with
  §3.6.1; single-day collapses `from = to`.
- Scope picker: **not cluster-only**. The metric pack renders at
  every drill level — India / Zone / State / Region / District /
  Cluster / Village (decisions.md D14).
- Metrics for the selection:
  - **attendance %** = sessions with an attendance row / scheduled
    attendance sessions in scope × date range.
  - **average children** per session in scope × date range.
  - **image %** = sessions with ≥ 1 image tagged to the same
    event / village / day / scheduled sessions (decisions.md D13).
  - **video %** = sessions with ≥ 1 video tagged to the same
    event / village / day / scheduled sessions (decisions.md D13).
  - **SoM current vs previous month** — current-month count with a
    delta chip against the previous full calendar month.
  - **bar chart** — attendance trend. 6-month window at cluster
    level and above, 3-month at district / village.
- **View More** drills to per-village rows within the chosen
  cluster. At non-cluster levels the button is absent (users
  drill by tapping the table row, as in §3.6.1). At village level
  it is absent (already at the leaf).

#### 3.6.3 Acceptance
- CSV export mirrors the on-screen table exactly (same columns,
  same order, same filter).
- A District+ admin cannot see another district's data (enforced
  server-side).

#### 3.6.4 Field-Dashboard Home
Default landing page for every authenticated user (decisions.md D17).
Replaces the India-level drill that previously served as Home; the
drill-down (§3.6.1) moves to `/dashboard`. VCs with a single village
no longer auto-redirect — they land on Home like everyone else.

**Composition is capability-gated.** The same route `/` renders a
different block set depending on which capabilities §2.3 grants the
user. "Doer" roles carry at least one `.write` capability (VC, AF,
Cluster Admin, Super Admin); "observer" roles carry only `.read`
(District+). Blocks render in the order below, skipping any whose
gate is not satisfied.

| # | Block | Gate | Who sees it |
|---|---|---|---|
| 1 | Greeting + scope chip + time-preset switch | always | all roles |
| 2 | Health Score card | `dashboard.read` | all roles |
| 3 | Today's Mission | any `.write` cap | doer roles |
| 4 | Focus Areas (top-3) | `dashboard.read` | all roles |
| 5 | Sibling-compare grid (full) | no `.write` cap | observer roles |
| 6 | Capture FAB (floating) | `media.write` or `attendance.write` | doer roles |

A doer therefore sees 4 body blocks + FAB; an observer sees 4 body
blocks + no FAB. Maximum 5 elements per role, keeping the page
scan-in-one-glance.

**Time-preset switch.** Three presets only: **7D** (default), **30D**,
**MTD**. Custom date ranges stay on `/dashboard` (decisions.md D20).
All blocks on Home recompute off the selected preset; the server
also returns a trend delta against the previous equivalent window
(previous 7D, previous 30D, MTD of prior calendar month).

**Health Score.** A 0–100 composite over the §3.6.2 metric pack
(attendance %, image %, video %, SoM ratio) within scope × preset.
Inputs are the same data §3.6.2 already exposes; the weighting is a
worker env var, not a schema column, and defaults are documented
out-of-spec. Returned with a trend arrow vs. the previous window.
Deterministic formula — no ML.

**Today's Mission** (doer roles only; decisions.md D18). Server
ranks the §3.6.2 gaps in scope × preset as `(target − current) / target`
for attendance, image %, video %, and SoM coverage; picks the
largest and returns `{kind, current, target, copy}`. The client
renders `copy` with a progress strip `current / target`. Tapping
the card opens the natural write path for `kind` — Capture for
image / video, Attendance for attendance, Achievements for SoM.

**Focus Areas.** Top-3 direct-child scopes (not leaf children) in
the user's scope, ranked by the same gap heuristic as Mission but
excluding Mission's `kind` to avoid duplication. Each chip shows
scope name + headline metric; tap deep-links to that scope on
`/dashboard` with the preset preserved.

**Sibling-compare grid** (observer roles only; decisions.md D19).
Full grid of every direct-child scope in the user's scope, one row
per child, columns for each §3.6.2 KPI plus Health Score and trend.
Preset-windowed. Sortable by any column; default sort is Health
Score ascending so the worst-performing scopes surface first. Row
tap drills to that child on `/dashboard` with preset preserved.
The `/dashboard` drill-down is still the path for cross-level
navigation (e.g. jumping from India to a specific Cluster) and for
CSV export; Home is "start at your scope and see how your children
are doing", `/dashboard` is "walk the hierarchy".

**Capture FAB.** Floating bottom-right, one tap, pre-scoped to the
user's current scope (VC: own village; AF / Cluster / Super: last
used, or prompt to pick). Opens the existing Capture sheet.

**API.** `GET /api/dashboard/home?window=7d|30d|mtd&scope=<level>:<id>`
returns `{scope, window, healthScore, mission?, focusAreas,
compareGrid?}`. Gated by `requireCap('dashboard.read')`. `mission`
is present iff the caller has any `.write` cap; `compareGrid` is
present iff the caller has none. `compareGrid` carries one row per
direct-child scope with every §3.6.2 KPI + Health Score + trend.

**Acceptance.**
- A VC logs in and lands on `/`, **not** their village. The page
  shows Health Score + Mission + Focus Areas + Capture FAB.
- A State Admin lands on `/` and sees Health Score + Focus Areas +
  a full sibling-compare grid over their direct-child scopes; no
  Mission card, no FAB.
- Switching the time preset triggers exactly one `/api/dashboard/home`
  fetch; all blocks refresh consistently.
- Focus Areas and compare-grid rows deep-link to `/dashboard` with
  scope and preset preserved in URL state; the drill-down lands
  already filtered.
- Capability shape, not role name, decides composition. Adding a
  new observer role in `packages/shared/src/capabilities.ts` (only
  `.read` caps) automatically gives it the observer Home with no
  UI changes.

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

Parity with the vendor app, trimmed hard. Only Profile and Master
Creations remain; the five content-hub sub-screens were cancelled
in decisions.md D15 (vendor-platform carryover — none of them
serve a workflow a NavSahyog user can't accomplish out-of-band).

#### 3.8.1 Profile
- Read-only: name, user ID, date of joining, role, assigned geo
  scope. Link: "Report an error" (opens a prefilled email to the
  user's AF).

#### 3.8.2 Notice board
- **Cancelled — decisions.md D15.** Ops-to-staff broadcasts happen
  out-of-band (WhatsApp, email). Section header retained for stable
  cross-references; the `notice` table, `/api/notices` surface, and
  §6.1 offline notices flag are all removed.

#### 3.8.3 About Us
- **Cancelled — decisions.md D15.** The `about_us` table and
  `/api/about` route are removed. Org information lives on the
  NavSahyog website, not inside the ERP.

#### 3.8.4 Reference links
- **Cancelled — decisions.md D15.** The `reference_link` table and
  `/api/reference-links` surface are removed. Curated links live
  out-of-band.

#### 3.8.5 Quick Phone / Quick Video links
- **Cancelled — decisions.md D15.** The `quick_link` table and
  `/api/quick-links` surface are removed. Contact numbers and
  training videos are distributed out-of-band.

#### 3.8.6 Language switcher
- **Cancelled as a dedicated screen — decisions.md D15.** The
  i18n module stays (en + hi ship in L2.5); the language toggle
  lives in the existing user menu, not as its own secondary screen.
  Adding a language remains a matter of dropping a
  `locales/<code>.json` catalog and registering it in the client
  i18n module.

#### 3.8.7 Master Creations (Super Admin only)
- Consolidated CRUD for each master (villages, schools, events,
  activities, qualifications, roles, users). Not a generic table
  editor — one dedicated screen per master, with only the fields
  the bespoke app actually uses. Content-hub masters (`notice`,
  `reference_link`, `quick_link`, `about_us`) were cancelled in
  D15 and do not appear. No "app settings" screen — retention is
  out-of-system; other tunables are Worker env vars (D1).

---

### 3.9 Donor engagement

NavSahyog engages donors against the village(s) they sponsor. The
donor ↔ village mapping is maintained **outside** this system (a
spreadsheet the central office keeps); the ERP's role is only to
supply the raw material for an update, which the operator drafts,
reviews, and sends manually via email or WhatsApp.

#### 3.9.1 Invocation
- **Inputs** (per the operator):
  - village (UUID; resolve by name via `/api/geo/villages?q=`, §5.3)
  - date range (`from`, `to`) — any window the operator picks
  - channel (`whatsapp` | `email`)
  - optional: donor name, tone hint, length, language
- **Behaviour**: the AI skill
  (`.claude/skills/donor-update/SKILL.md`) composes reads across
  children (§5.6), attendance (§5.9), achievements (§5.10), and
  media (§5.8) for the village and window, and emits:
  1. a markdown draft (email- or WhatsApp-shaped) plus a "sources
     used" block, and
  2. a 1-pager A4 PDF rendered from one of the three bundled
     templates in `.claude/skills/donor-update/references/themes/`
     (each a distinct layout, not just a palette): `quarterly`
     (default — 5-stat strip + story + 3-photo grid, data-forward),
     `milestone` (full-width hero photo + single achievement
     headline, formal), or `celebration` (saffron hero band + 2×2
     photo mosaic + wins list, festive). Produced by
     `references/render.mjs` via Playwright; each theme has its
     own required JSON shape documented in
     `references/README.md`.
- No write occurs against the operational schema — the skill is
  read-only. Distribution happens outside the system.

#### 3.9.2 Scope and PII
- Gated by the `donor_update` capability (§2.3). A 403 on any
  underlying API halts the draft and surfaces the scope error to
  the operator.
- No child PII beyond first names tied to a public achievement
  (SoM, medal). No last names, DOB, parent names, school names,
  or parent Aadhaar (which is masked anyway per §9.2). Child
  Aadhaar does not exist in the schema (§9.1).

#### 3.9.3 Media consent
- **Current assumption**: every `/api/media` row is treated as
  donor-shareable. Placeholder — §9 does not yet distinguish
  internal from external use of child images/videos. Tracked in
  `review-findings-v1.md` U7; must close before public launch.
- Once §9 adds a `donor_shareable` flag, the skill must filter
  on it before including any item.

#### 3.9.4 Acceptance
- Every stat in the draft traces to an API response recorded in
  the sources block — no fabrication.
- Each invocation appends a `donor_update.draft` row to
  `audit_log` with `(operator, village, from, to, timestamp)`
  per §9.4.
- Online-only workflow; not in the §6.1 offline scope.

