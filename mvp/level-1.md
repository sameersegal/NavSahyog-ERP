# Level 1 — Multi-role skeleton, one cluster

**Status: landed** (PRs #18–#21). Scaffold + UI polish pass: logo,
three themes (light / dark / sunlight), user menu, responsive
layout, attendance mass-ops, en + hi i18n. Screenshots in
`mvp/screenshots/l1/`.

## What L1 proved

End-to-end stack (Pages + Workers + D1) and the role / scope model
on a minimal feature surface.

## What shipped

- **Auth (§3.1.1, trivial form).** User ID + password, plain-text
  comparison against seeded `user`. Signed token in KV, 12h TTL.
- **Roles (§2.1, §2.3).** VC / AF / Cluster Admin / Super Admin
  wired end-to-end. Scope claim in the session; every write enforces
  it server-side via `requireCap(...)`.
- **Geo seed (§2.2, §4.3.2).** One Zone → State → Region → District
  → Cluster → 3–5 Villages.
- **Children (§3.2.1, §3.2.2 partial).** List + create (required
  fields only — no photo, no parents).
- **Attendance (§3.3).** Today only. `POST /api/attendance` with
  `{ village_id, student_marks: [...] }`.
- **Drill-down dashboard (§3.6.1, 2 tiles).** Children + Attendance,
  cluster → village drill. No CSV export yet.
- **PWA shell (§11.2).** React + Vite on Cloudflare Pages.
- **Themes.** Three themes — `light` (default), `dark` (evening),
  `sunlight` (outdoor / high-contrast). HSL CSS vars; adding a
  fourth is a one-file change. Persisted in localStorage.
- **Language toggle (en + hi).** Pulled forward because field-staff
  UI is Hindi-first. The dedicated §3.8.6 switcher screen was
  cancelled in D15; the in-menu toggle is the only affordance.

## Stack choices established here

- pnpm workspaces — `apps/web`, `apps/api`, `db/`.
- Hand-rolled fetch handler + small router in the Worker.
- Auth state in KV: `session:<token>` → JSON claim.
- Local dev: `wrangler dev` + `vite` + D1 local binding.

## Explicitly deferred (still)

Photos / R2 (§3.4, §7) — landed in L2. Achievements (§3.5) —
landed in L2. Consolidated dashboard (§3.6.2) — folded into
drill-down per D12, landed in L2.5. Master Creations (§3.8.7) —
L3. Profile (§3.8.1) — L3.2. §3.8.2–§3.8.6 cancelled (D15).
Offline (§3.7, §6) — L4. Password hashing / OTP / lockout
(§3.1.2–§3.1.4) — L5. Audit log (§9.4) — L5. Migration (§10) — L5.
