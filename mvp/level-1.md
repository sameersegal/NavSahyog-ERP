# Level 1 — Multi-role skeleton, one cluster

**Status:** scaffold landed. Typechecks pass, dev smoke tests
green (see end-to-end verification below). Open questions below
remain unresolved.

## Goal

Prove the stack end-to-end (Pages + Workers + D1) and lock in the
role / scope model on the smallest possible feature surface.

## In scope

- **Auth (§3.1.1, trivial form only).** User ID + password in a
  POST form. Plain-text comparison against a seeded `user` table.
  Session is a signed token stored in KV with a 12h TTL. No
  lockout, no OTP, no forced password change, no default-password
  flow.
- **Roles (§2.1, §2.3).** VC / AF / Cluster Admin / Super Admin
  wired end-to-end. Scope claim in the session; every write
  endpoint enforces it server-side per the capability matrix.
- **Geo seed (§2.2, §4.3.2).** One Zone → State → Region → District
  → Cluster → 3–5 Villages, all dummy. Seeded via `seed.sql`.
- **Children (§3.2.1, §3.2.2 partial).**
  - `GET /api/children?village_id=…` — list active children in
    scope.
  - `POST /api/children` — required fields only: first name, last
    name, gender, DOB, village (pre-filled), school (picker from
    seeded schools). No photo, no parents, no alt contact.
- **Attendance (§3.3).** Today only, no event picker, no voice
  note.
  - `POST /api/attendance` — `{ village_id, student_marks: [{student_id, present}] }`.
  - `GET /api/attendance?village_id=…&date=…`.
- **Drill-down dashboard (§3.6.1, 2 tiles).** Children + Attendance
  only. Cluster → village drill. No Excel export.
- **PWA shell (§11.2).** React + Vite on Cloudflare Pages. Install
  prompt out of scope.

## Explicitly deferred

- Photos, media capture, R2, EXIF (§3.4, §7).
- Achievements (§3.5).
- Consolidated dashboard (§3.6.2).
- Master Creations (§3.8.7).
- Notices, Reference links, Quick links, About Us, Profile, language
  switcher (§3.8.1–§3.8.6).
- Offline mode, IndexedDB outbox (§3.7, §6).
- Password hashing, lockout, OTP, forced change (§3.1.2–§3.1.4).
- Excel export (§3.6.3).
- Audit log (§9.4).
- Retention cron (§9.3).
- Migration (§10).

## Acceptance

1. Seed produces one cluster with one VC, one AF, one Cluster
   Admin, one Super Admin, 3–5 villages, ~20 children total.
2. VC login → sees own village only in child + attendance UIs.
3. AF login → sees all villages in the cluster; can mark
   attendance for any of them.
4. Cluster Admin login → identical visibility to AF (for now; L3
   adds master CRUD).
5. Super Admin login → sees the full cluster.
6. A request with a VC session that tampers `village_id` to a
   village outside their scope returns `403`, not `404`, and the
   attempt is logged to server logs (audit log proper is L5).
7. Drill-down dashboard renders the correct counts; numbers match
   a direct SQL query against D1.

## Stack choices for this level

- **Monorepo** with pnpm workspaces: `apps/web` (React + Vite
  PWA), `apps/api` (Cloudflare Worker), `db/` (schema + seed).
- **Routing** in Worker: hand-rolled `fetch` handler with a small
  router. No framework dependency.
- **Auth state** in KV: `session:<token>` → JSON claim.
- **Local dev**: `wrangler dev` for the Worker, `vite` for the
  web app, D1 local binding for the DB.

## Open questions

- [ ] Do we want seeded users to have memorable IDs
      (`vc-village1`, `af-cluster1`) or should we mimic the vendor
      format (`VC-BID01-007`)? Memorable wins for a lab demo;
      vendor format is closer to what migration (L5) will face.
- [ ] Dashboards in L1: render in-table counts only, or also a
      tiny bar chart? Counts-only keeps the level tight.
