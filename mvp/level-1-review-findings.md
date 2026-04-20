# L1 review findings

Foundation review of PR #18 (`claude/mvp-complexity-roadmap-xkXF5`,
merged 2026-04-20). The L1 scaffold is solid in scope and visual
polish; the items below are foundation gaps that get expensive if
they survive into L2.

Format mirrors `requirements/review-findings-v1.md`:
**BLOCKER → HIGH → MEDIUM → LOW**, each with file:line refs and a
one-line fix.

This doc is **not** part of the spec — it's a working list. As each
item lands, mark it `fixed in <commit/PR>`.

**Status:** B1, B2, B3, B4, H3, H4 (CI + tests — linter still open),
H5, H6, H7, M1, M2, M3, M4, M5 are fixed on
`claude/review-mvp-foundation-OGA8L`. H1 (PWA), H2 (migrations),
M6 (scope_id FK), and the LOW items remain open and are tagged
inline.

---

## BLOCKER — fix before any L2 work

### B1 — CORS reflects any origin with credentials *(fixed on review-mvp-foundation)*
- `apps/api/src/index.ts:15-21` —
  `origin: (origin) => origin ?? '*', credentials: true`.
- Effectively disables CORS once deployed. Hidden today because
  same-origin via the Vite proxy.
- **Fix.** Read an allowlist from a Worker var
  (`ALLOWED_ORIGINS`, comma-separated). Echo only matched origins.

### B2 — Authorization is a no-op dead block *(fixed on review-mvp-foundation)*
- `apps/api/src/routes/children.ts:50-53` and
  `apps/api/src/routes/attendance.ts:50-53`:
  ```ts
  if (user.role === 'super_admin' || user.role === 'vc' || ...) {
    // allowed — cluster_admin included per §2.3
  }
  ```
- The `if` has no `else` and no early return — any authenticated
  role passes. Will silently grant write to district_admin /
  read-only roles when L2 seeds them.
- **Fix.** Use the existing `requireRole` helper at
  `apps/api/src/auth.ts:77` with an explicit allow-list. Doubles
  as the implementation of blocker B3 in
  `requirements/review-findings-v1.md`.

### B3 — `database_id = "local-placeholder"` *(fixed on review-mvp-foundation)*
- `apps/api/wrangler.toml:11`. Worker cannot deploy.
- **Fix.** Either bind the real D1 ID and commit, or split a
  `wrangler.local.toml` and document the deploy path. For L1, a
  comment + clearer name (`local-only-replace-before-deploy`) is
  enough — but it must not silently survive into L2 deploy work.

### B4 — "today" defined in UTC, not IST *(fixed on review-mvp-foundation)*
- `apps/api/src/routes/attendance.ts:13-19`,
  `apps/api/src/routes/dashboard.ts:17-19`, and
  `apps/web/src/pages/Village.tsx:12-15` all use
  `Math.floor(now / 86400) * 86400`.
- India is UTC+05:30. Between 18:30–00:00 IST every day the
  server's "today" is already tomorrow for the VC. Acceptance
  criterion #2 in `mvp/level-1.md` will fail near midnight.
- **Fix.** One `istDayStart(epoch)` helper, used everywhere.
  Spec §2.2 is explicit that the app is India-only.

---

## HIGH — fix in the next foundation PR

### H1 — No PWA manifest / service worker
- `apps/web/index.html` has no `<link rel="manifest">`;
  `apps/web/public/` has no `manifest.webmanifest` or SW.
- `mvp/level-1.md` lists "PWA shell (§11.2)" in scope. As-shipped
  it's a React SPA, not a PWA. L4 offline starts from zero
  otherwise.
- **Fix.** Add a minimum manifest + a hand-rolled SW (or
  Workbox). Install prompt stays deferred per L1.

### H2 — No migrations tool
- `apps/api/package.json:11-13` — `db:reset` = drop + apply +
  seed. Any non-seed data is destroyed when a column is added.
- **Fix.** Switch to `wrangler d1 migrations` (built-in) before
  L2 introduces real columns.

### H3 — Cookie `secure: false` is hardcoded *(fixed on review-mvp-foundation)*
- `apps/api/src/auth.ts:73`. Session cookie will travel over
  HTTP in production.
- **Fix.** Drive from a Worker var (`ENVIRONMENT === 'production'`).

### H4 — No CI, no linter, no tests *(CI + tests landed; linter still open)*
- No `.github/workflows/`, no eslint/prettier, no vitest.
- PR-level verification ("typechecks pass, 186 KB bundle") is not
  enforced on future PRs.
- **Fix.** One workflow that runs `pnpm -r typecheck && pnpm -r build`
  on push. Linter/tests can land separately.

### H5 — No `app_settings` table *(fixed on review-mvp-foundation)*
- §4.3.8 specifies it; U5 in `requirements/review-findings-v1.md`
  flagged it; L1 schema (`db/schema.sql`) does not include it.
- Every configurable (session TTL, retention, default lang) goes
  in via code instead.
- **Fix.** Create the empty table now: `key TEXT PRIMARY KEY,
  value TEXT, updated_at INTEGER NOT NULL`. Zero rows seeded —
  the shape is what matters.

### H6 — Error-response shape is inconsistent *(fixed on review-mvp-foundation)*
- Routes return `{ error: 'forbidden' }` (string) while
  `apps/api/src/index.ts:32-35` returns
  `{ error: 'internal_error', message: ... }` (tagged).
- **Fix.** Pick one shape (recommend `{ error: { code, message } }`
  from §5) and provide a small helper.

### H7 — Scope-violation not logged *(fixed on review-mvp-foundation)*
- `apps/api/src/scope.ts:25-32` returns `false`; routes return
  403 silently.
- L1 acceptance #6 explicitly requires logging the attempt to
  server logs.
- **Fix.** `console.warn` on the failure path with
  `{ user_id, attempted_village_id }` at minimum.

---

## MEDIUM

### M1 — `dob` stored as epoch seconds *(fixed on review-mvp-foundation)*
- `db/schema.sql:95`. Birthdates have no time-of-day. Same
  UTC/IST trap as B4.
- **Fix.** Switched `student.dob`, `student.joined_at`,
  `student.graduated_at`, and `attendance_session.date` to
  `TEXT 'YYYY-MM-DD'` in IST. `created_at` / `expires_at` stay
  UTC epoch (instants, not dates). The IST helper now collapses
  to a single `todayIstDate()` boundary at request entry, which
  also tightens B4 from three failure modes to one.

### M2 — `auth.login.hint` leaks a credential pair in all builds *(fixed on review-mvp-foundation)*
- `apps/web/src/pages/Login.tsx:42` + `locales/*.json`.
- A production-bundled lab build advertises `vc-anandpur / password`.
- **Fix.** Gate on `import.meta.env.DEV`.

### M3 — i18n catalog drift risk *(fixed on review-mvp-foundation)*
- `apps/web/src/i18n.tsx:37-40` falls back to `en` on missing
  key — silent. A missing Hindi string ships with English text.
- **Fix.** Build-time check that every `en` key exists in `hi`.
  Either a unit test or a small `scripts/check-i18n.ts`.

### M4 — Duplicated `startOfUtcDay` / `todayUtc` *(fixed on review-mvp-foundation)*
- `attendance.ts:13-19` and `dashboard.ts:17-19`.
- **Fix.** Extract to `apps/api/src/lib/time.ts` (also closes B4).

### M5 — SELECT after INSERT to get `session_id` *(fixed on review-mvp-foundation)*
- `apps/api/src/routes/attendance.ts:92-98`.
- **Fix.** `INSERT ... RETURNING id` (already used in
  `children.post` at line 77).

### M6 — `scope_id` has no FK
- Already raised as U4 in `requirements/review-findings-v1.md`;
  unresolved in the schema that just landed.
- **Fix.** Document the soft invariant in a schema comment at
  minimum, or move to a junction table (pairs with H1 in the
  requirements review).

---

## LOW

- **L1.** `apps/api/src/auth.ts:6` `SESSION_TTL_SECONDS = 12*60*60`
  hardcoded — moves to `app_settings` once H5 lands.
- **L2.** `engines.node >= 22` in root `package.json:20` has no
  `.nvmrc` to back it.
- **L3.** `apps/web/src/i18n.tsx:32-33` navigator-language
  detection drops country suffix; intentional but worth a
  one-line comment so a future reader doesn't "fix" it.
- **L4.** `mvp/` is not referenced from the repo map in `CLAUDE.md`.

---

## What the PR got right

- Clean module split (`routes/`, `auth.ts`, `scope.ts`,
  `types.ts`). No god-files.
- `requireAuth` mounted at router-level via
  `children.use('*', requireAuth)` — consistent everywhere.
- `SessionUser` typed once and reused — a clean shape for L5
  when KV replaces the table.
- Theme + i18n layering at `main.tsx:10-22` keeps DOM
  side-effects outside components. Adding a language really is
  the documented two-step.
- Seed is self-contained and reversible (`DELETE FROM` block at
  the top of `seed.sql`).
- `UNIQUE(village_id, date)` on `attendance_session` and
  `UNIQUE(session_id, student_id)` on marks make POST implicitly
  idempotent, even before an `Idempotency-Key` header lands.

---

## Tracking — fix order

This PR (`claude/review-mvp-foundation-OGA8L`) takes the
"Recommended next commit" list from the review:

1. B1, B2, B3, B4, H7 — security + correctness.
2. H5 — empty `app_settings` table.
3. H6 — error shape + helper.
4. H4 (partial) — minimal CI workflow.
5. M2, M3, M4, M5 — cheap cleanups in the same neighbourhoods.

H1 (PWA) and H2 (migrations) are deferred to their own PRs
because each touches the dev loop / build pipeline.
