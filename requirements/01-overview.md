[← Index](./README.md) · [§2 Users & roles →](./02-users-and-roles.md)

---

## 1. Overview & goals

### 1.1 Context
NavSahyog Foundation is an Indian NGO running child-development programs
in villages across multiple states. Field staff (Village Coordinators,
Area Facilitators) record attendance, achievements, and photo/video
evidence daily. Managers view drill-down dashboards by geography.

The current mobile app (`Navshayog-4.5.2.apk`, package `io.ionic.ngo`,
backed by the vendor's dev and production REST backends) is a
white-label product from an external vendor. It is
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
4. Migrate existing data without loss.
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
| Async | Queues (offline-upload retry, media derivation). |
| Sessions / OTP | KV. |
| Live counters (optional) | Durable Objects per cluster. |

### 1.5 Program-based public apps

The NavSahyog public website hosts **program apps** — small,
read-only, embeddable widgets that show what a given program is
doing in the field. They run on `navsahyog.org` (or partner sites),
not inside the ERP, and are visible to anyone who reaches the
page: prospective partners, journalists, government counterparts,
prospective field staff, supporters, and the general public. The
first program app is the Jal Vriddhi pond infographic; future
programs (Dhan Kaushal, Prakriti Prem, …) follow the same
pattern.

Each program app is backed by exactly one **public program API**
under `/api/programs/<slug>` (contract pinned in §5.19). The
website embeds these via custom JS — no auth, no cookies, no
server-side rendering on our end. Concretely:

- **Read-only.** No write or mutation surface is ever exposed to
  the public.
- **Aggregate + per-row.** The API returns the stats and markers
  the embedder needs to render its widget; the embedder owns the
  visual design.
- **PII-scrubbed at the response builder, not just at display.**
  Names, phone numbers, plot identifiers, free-text notes,
  agreement metadata, and internal user ids never reach the wire.
  Coordinates are coarsened to ~110 m so an exact farm plot can't
  be pinpointed (§5.19, §9.5).
- **Isolated from the authenticated app.** Public traffic is rate-
  limited at the edge and CORS-locked to known embedder origins so
  a noisy widget on a partner page can't degrade the VC dashboard
  experience (§5.19).

**Non-goals.** No NavSahyog-hosted SPA per program (the in-app
public-infographic page floated in early L3.3 work was dropped —
it duplicated work the website team already does). No
authenticated visitor logins or per-visitor dashboards on the
public surface; once a workflow needs auth, it belongs inside the
ERP, not on the public website.

