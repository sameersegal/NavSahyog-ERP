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

The NGO onboarding doc (`NSF-App-Process-Document-English.txt`)
is the **authoritative source for user-facing workflows**. If a
requirement disagrees with it, flag that as a finding — don't
"fix" the onboarding doc.

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
- Awaiting stakeholder review via `review-findings-v1.md`.
- **No code has landed yet.** First vertical slice (per
  `requirements/appendix-status-and-next-steps.md`) will be
  `/auth/login` + `/api/children`, unblocked by the B1–B3
  decisions in the review doc.

## Repo map

```
/
├── README.md                                 ← project landing page (for humans on GitHub)
├── CLAUDE.md                                 ← you are here
├── NSF-App-Process-Document-English.txt      ← onboarding doc (authoritative for workflows)
├── Navshayog-4.5.2.apk                       ← the vendor app being replaced
└── requirements/
    ├── README.md                             ← index
    ├── 01-overview.md  …  11-cloudflare-mapping.md
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
| Role / capability | §2.3 matrix · §5 endpoint gates · §3 workflow descriptions |
| Schema column | §4 DDL · §5 request/response · §6 outbox body shape · §10 field mapping |
| New endpoint | §5 · §6.4 (offline-enqueuable?) · §8.5 rate limits · §11.9 secrets if it calls an external service |
| New workflow | §3 · capability matrix · scope rules · §6.1 offline scope |
| Retention / settings | §4.3.8 `app_settings` · §7.7 · §9.3 · §11.3 cron |
| Non-functional target | §8.13 SLOs · §11.11 cost envelope |

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
  non-trivial CSS). Commit the PNGs under a sensible path (e.g.
  `mvp/screenshots/<level>/`) and reference them with raw GitHub
  URLs — `https://github.com/<owner>/<repo>/blob/<branch>/<path>?raw=true`
  — so they render in the PR description. Skip for API-only or
  docs-only changes.

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
- Commit `.env`, credentials, new `.apk` files, or other large
  binaries. The existing `Navshayog-4.5.2.apk` is intentional.
- Rotate the Google Maps API key baked into the vendor APK in
  place — it's a vendor artefact, marked "rotate before public
  release" of the bespoke app.
- Force-push to `main`. Never.
- Delete `origin` branches without explicit permission. The git
  proxy may 403 deletes anyway — ask the user to clean up via
  GitHub UI.
- "Fix" the onboarding doc to match a requirement. The doc is
  authoritative; the requirement must be made to match, or the
  divergence flagged as a finding.

## When in doubt

Ask. This is a small repo with a single maintainer; a one-line
clarifying question ("A or B? I'd pick A because …") is cheap
and shipping the wrong thing is expensive.
