[← §1 Overview](./01-overview.md) · [Index](./README.md) · [§3 Functional →](./03-functional.md)

---

## 2. Users & roles

### 2.1 Actors
Derived from the onboarding doc and the decompiled app.

| Role | Scope | Primary actions |
|---|---|---|
| Village Coordinator (VC, a.k.a. Teacher) | One village | Daily attendance, achievements, capture media |
| Area Facilitator (AF) | Multiple villages in a cluster | VC actions + pick village on media upload, manage students |
| Cluster Admin | A cluster | AF actions + master data within their cluster |
| District / Region / State / Zone Admin | Respective geo level | Read-only drill-down dashboards + CSV export |
| Super Admin | Global | User management, all master CRUD |

### 2.2 Geo scope (simplified hierarchy)
```
Country (= India, fixed) → Zone → State → Region → District → Cluster → Village
```
Drop the vendor's `Territory` and `Taluk` levels unless migration turns
up populated rows (flag for confirmation).

Every user is anchored to exactly one node in this tree. Their
**effective scope** is that node and everything beneath it.

### 2.3 Capability matrix
Hardcoded in Workers (no `role_permission` table). The per-endpoint
capability → role mapping is generated from the code:

- **Source of truth:** `packages/shared/src/capabilities.ts`
  (`CAPABILITIES_BY_ROLE`).
- **Per-endpoint matrix (capability + roles + offline mode):**
  [`generated/endpoints.md`](./generated/endpoints.md), produced by
  `pnpm matrix` from the route metadata. CI runs `pnpm matrix:check`
  to fail builds when the file is stale.

What the generated matrix doesn't capture is **scope breadth** —
how wide the data window is for a role that holds a capability.
That stays in prose because it's enforced at runtime by
`villageIdsInScope()` (apps/api/src/scope.ts), not by `requireCap`:

| Surface | VC | AF | Cluster | District+ | Super |
|---|---|---|---|---|---|
| Drill-down dashboard | own village | cluster | cluster | own level | global |
| Consolidated dashboard | — | cluster | cluster | own level | global |
| CSV export | — | ✔ | ✔ | ✔ | ✔ |

The forward-looking "Donor update (draft) — §3.9" row in the
previous version of this section refers to a feature that has not
landed in code; it's tracked in §3.9 directly.

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

