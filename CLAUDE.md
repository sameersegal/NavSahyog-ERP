# CLAUDE.md

This is your orientation file. Read it end-to-end before doing
anything else. It is short on purpose.

## Before you start any task

Read these three files, in order:

1. **This file.** Conventions, pitfalls, do-not list.
2. **`requirements/README.md`** — index of the specification
   (one file per section, §1 – §11, plus appendix and
   review-findings).
3. **`requirements/review-findings-v1.md`** — the active issue
   list. Anything you're about to edit may already be flagged as
   a blocker or open decision. Check before changing it.

## Project in one paragraph

Bespoke replacement for the NavSahyog vendor app (package
`io.ionic.ngo`, backed by the vendor's REST backend). Target
stack: React PWA on Cloudflare Pages + Workers + D1 + R2 + Queues
+ KV. **Single-tenant, India-only, Android + PWA first.** The
vendor app is a generic multi-tenant platform; our job is to cut
every piece of generic-platform complexity the bespoke nature
lets us drop. See §1.3 of the spec for the non-goals that express
this.

## Current project state

- Requirements v1 draft complete across all 11 sections.
  Resolved decisions live in `requirements/decisions.md`;
  open items in `requirements/review-findings-v1.md`.
- **MVP ladder in flight** against dummy data (lab-only,
  no real PII). Canonical status is `mvp/README.md` and
  the per-level files. At the time of writing:
  - **L1 landed** — multi-role skeleton, themes, en + hi
    i18n (PRs #18–#21).
  - **L2 landed** end-to-end — full write loop + drill-down
    dashboards with CSV + media pipeline on local R2
    (PRs #22–#25, covering L2.0–L2.4).
  - **L2.5 landed** — mobile-first dashboard polish +
    §3.6.2 consolidated fold, closing L3.1 early (PR #31).
- **Up next: L3** (Master Creations + secondary screens,
  §3.8.1–§3.8.7). L4 (offline) and L5 (auth + compliance)
  remain not started; L5 is gated on the decision to move
  past dummy data.

## Repo map

```
/
├── README.md                                 ← project landing page (for humans on GitHub)
├── CLAUDE.md                                 ← you are here
├── apps/
│   ├── web/                                  ← React + Vite PWA on Cloudflare Pages
│   └── api/                                  ← Cloudflare Worker (routes + D1 + R2 + KV)
├── db/                                       ← D1 schema + migrations + seed
├── packages/                                 ← shared TS packages (types, utils)
├── scripts/                                  ← Playwright capture scripts, i18n check
├── mvp/
│   ├── README.md                             ← MVP ladder (canonical MVP status)
│   ├── level-1.md  …  level-5.md             ← per-level scope + status
│   └── screenshots/                          ← per-level UI captures for PR bodies
└── requirements/
    ├── README.md                             ← index
    ├── 01-overview.md  …  11-cloudflare-mapping.md
    ├── decisions.md                          ← resolved decisions, dated
    ├── appendix-status-and-next-steps.md
    └── review-findings-v1.md                 ← active issue list
```

## How to work on this repo

### Planning and tool use
- Use **TodoWrite** for any task with more than 3 steps. Mark
  items complete as you finish them — don't batch.
- Exactly one task in_progress at a time.
- Prefer **Read / Edit / Write / Grep / Glob** over Bash. Use Bash
  for git, mkdir, wc, and tasks no dedicated tool covers (e.g.
  `sed -n 'X,Yp'` when splitting a file by line ranges).
- Delegate to a subagent when you need to read 2 000+ lines or
  search widely, and the task doesn't require your judgement
  mid-read. Don't delegate the synthesis or the decision.

### Editing the spec
The specification lives in `requirements/`. Rules:

1. **Section numbering is stable.** Never renumber. Use
   sub-numbering (§4.3.7.1) when adding content.
2. **Verify after every substantive edit.** Run:

   ```
   grep -c '^## \|^### ' requirements/<file>.md
   ```

   before and after. We lost §9 Compliance once because an edit
   silently dropped it (see `review-findings-v1.md` §0).
3. **TOC and body stay in sync.** If you add / rename a
   subsection, update `requirements/README.md` in the same
   commit.
4. **Cross-references are plain text** (`§3.4`, not
   `[§3.4](./03-functional.md#...)`). Readers navigate via the
   folder index.
5. **Don't create new top-level docs in `requirements/`** unless
   the user asked. The natural homes for future additions are:
   - `requirements/decisions.md` — outcomes of review-findings
     discussions (create when first decision lands).
   - `requirements/defaults.md` — operational tuning values
     extracted from §8 and §11 (create when those are stripped
     per review-findings Medium list).

### Cross-section consistency
When you change any of these, check and update **every**
dependent section in the same commit:

| Change | Also check |
|---|---|
| Role / capability | `packages/shared/src/capabilities.ts` (single source of truth) · §3 workflow descriptions · §2.3 scope rules. Run `pnpm matrix` to refresh the generated per-endpoint matrix. |
| Schema column | §4 DDL · §5 request/response · §6 outbox body shape · §10 field mapping |
| New endpoint | Add `meta` block + `requireCap(...)` in the route file · §5 narrative spec · §6.4 (offline-enqueuable?) · §8.5 rate limits · §11.9 secrets if it calls an external service. Run `pnpm matrix`. |
| New workflow | §3 · `offline-scope.md` (authoritative offline category) · §2.3 scope rules · the route file's `meta.offline`. Run `pnpm matrix`. |
| Retention / runtime config | Out-of-system (decisions.md D1/D4). No `app_settings` table, no retention cron. §7.7 + §9.3 document the boundary; runtime tunables are Worker env vars. |
| Non-functional target | §8.13 SLOs · §11.11 cost envelope |

### Local preview and sign-off

After every iteration that touches running code (web or API),
serve it locally and hand the user a URL **before** claiming the
task is done. Sign-off happens in the user's browser, not by
reading the diff.

- Web only: `pnpm dev:web` → http://localhost:5173
- API only: `pnpm dev:api` → http://localhost:8787
- Both: `pnpm dev` (parallel)

Workflow per iteration:

1. Start the relevant dev server in the background.
2. Tell the user the URL plus the specific routes/screens to
   click through — golden path + whichever edges you changed.
3. Wait for the user's sign-off before committing.
4. Stop the dev server once they confirm; don't leave it
   dangling between iterations.

Skip this step only for docs-only changes or pure config edits
that have no runtime surface.

### Git and PRs
- **Branch naming:** `claude/<purpose>-veKWY`. Keep the `veKWY`
  suffix — it's the session marker from the harness.
- **Commits:** `docs(area): summary` or `feat(pkg): …`, first
  line ≤ 72 chars. Body explains *why*. End every commit with
  the session URL the harness gave you.
- **Don't amend.** Always new commits — amending is destructive
  when pre-commit hooks fail.
- **One PR per logical unit, `base = main` by default.** Stacked
  PRs have already caused one "merged but not on main" bug in
  this repo (PRs #4–#6; PR #7 had to catch up). Only stack when
  review quality genuinely benefits.
- When reviewing a PR, use `mcp__github__pull_request_read`
  rather than fetching the branch locally unless you need to
  run something. Comment sparingly.
- **Embed UI screenshots inline in the PR body** for any change
  with a visible surface (new page, layout shift, dashboard view,
  non-trivial CSS). Capture them from the same local preview the
  user just signed off on (see *Local preview and sign-off*),
  commit the PNGs under a sensible path (e.g.
  `mvp/screenshots/<level>/`), and reference them with raw GitHub
  URLs — `https://github.com/<owner>/<repo>/blob/<branch>/<path>?raw=true`
  — so they render in the PR description. Skip for API-only or
  docs-only changes.
- **Keep the PR title and body in sync with the branch.** When
  you push additional commits to a PR you already opened, refresh
  the title and description so they describe the *current* state
  of the branch — not just the original commit. Use
  `mcp__github__update_pull_request` after each push that
  meaningfully changes scope, summary bullets, screenshots, or the
  test plan. A stale PR body is worse than no PR body.

### Bespoke-simplification principle
Before adding any requirement or writing any code, ask: *would
the vendor's generic-platform version need this, but NavSahyog's
bespoke version not?* If yes, drop it. Concretely, we have
already dropped:

- `CorpId` / multi-tenancy.
- Dev/staging/prod selector in UI.
- Runtime `role_permission` matrix (hardcoded in Workers).
- 286-operation Struts surface (~32 REST routes).
- Unused geo levels (Territory, Taluk — pending confirmation).
- Generic offline twin tables (`*Offline`) — client-side outbox
  only.
- 6-language preload (default en + kn + ta).
- SQLite-WASM on the client (IndexedDB + outbox).

If you find vendor-style complexity still carried through,
flag it in `review-findings-v1.md` under Medium.

## Do not

- Create docs the user didn't ask for.
- Use emojis unless the user is using them first.
- Commit `.env`, credentials, `.apk` files, or other large binaries.
- Force-push to `main`. Never.
- Delete `origin` branches without explicit permission. The git
  proxy may 403 deletes anyway — ask the user to clean up via
  GitHub UI.

## When in doubt

Ask — but only when there's actually doubt. If you have a clear
recommendation with a one-line justification you'd write anyway,
just take it and note the trade-off in the same breath ("going
with A because X; B trades Y for Z if you want to override").
A two-option ask where one is obviously better isn't a decision —
it's a recommendation with framing noise that costs the user a
turn. Reserve clarifying questions for genuinely close calls,
irreversible actions, or anything touching production.
