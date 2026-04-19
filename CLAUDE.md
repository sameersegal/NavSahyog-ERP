# CLAUDE.md — Instructions for Claude working in this repo

This file tells Claude how to be productive in the NavSahyog-ERP
repo. It is short on purpose. Read it end-to-end before starting
any task.

## 1. What this repo is

Requirements and (eventually) code for **NavSahyog ERP**, a bespoke
replacement for the NavSahyog vendor app (`Navshayog-4.5.2.apk`,
package `io.ionic.ngo`, backed by VMR: `vmrdev.com/vmr/`,
`portal.viewmyrecords.com/vmr/`).

Target stack: React PWA on Cloudflare Pages + Workers + D1 + R2 +
Queues + KV. Single-tenant, India-only, Android + PWA first.

Project context of record:
- `HANDOFF.md` — original extraction of the vendor app (data model,
  API surface, plugins). Historical; don't rewrite.
- `NSF-App-Process-Document-English.txt` — NGO onboarding doc. The
  authoritative source for user-facing workflows. If a requirement
  disagrees with this file, flag it.
- `requirements/` — the specification (one file per section).
- `requirements/review-findings-v1.md` — active issues list.

## 2. Requirements docs — editing rules

Read these before touching anything under `requirements/`.

1. **One file per section.** §1 → `01-overview.md`, …, §11 →
   `11-cloudflare-mapping.md`. Index at `requirements/README.md`.
2. **Section numbering is stable.** Do NOT renumber when adding
   content. Use sub-numbering (§4.3.7.1) instead. Many inline
   cross-references rely on `§X.Y` being fixed.
3. **Verify after every edit.** Run `grep -c '^## \|^### '
   requirements/<file>.md` before and after big edits to confirm
   no section body was dropped. We lost §9 Compliance once
   already (see `review-findings-v1.md` §0 for the post-mortem).
4. **TOC status must match body.** The `README.md` table and any
   per-section status line should be updated together with
   content changes.
5. **Prose cross-refs stay as plain text** (`§3.4`, not
   `[§3.4](...)`). Readers navigate via the folder index.
6. **No new top-level docs** in `requirements/` unless asked.
   Decisions go in `requirements/decisions.md` (to be created
   when B1–H5 from `review-findings-v1.md` are resolved).
   Operational defaults go in `requirements/defaults.md` (to be
   created when the Medium-over-specification items are
   extracted).

## 3. The bespoke-simplification principle

The vendor app is a **generic multi-tenant NGO platform**. This
build is a **single-tenant, India-only, known-workflow** app.
Every spec edit and every code change should take that
simplification where it's available. Concretely:

- No `CorpId` / multi-tenancy.
- No dev/staging/prod selector in UI — it's a deploy concern.
- No runtime `role_permission` matrix — hardcode in Workers.
- No generic 286-operation Struts surface — ~32 REST routes.
- Drop unused geo levels (Territory, Taluk — pending confirmation).
- Only ship languages NavSahyog actively uses (default en + kn + ta).
- PWA first; Capacitor wrap only if Play Store distribution is
  required.
- IndexedDB + outbox for offline, not SQLite-WASM.

If you find vendor-style complexity still carried through, flag
it in `review-findings-v1.md` under Medium.

## 4. Branch & PR conventions

- **Branch naming:** `claude/<purpose>-veKWY`. The `veKWY` suffix
  is the session marker from the harness — keep it.
- **Commit subject:** `docs(<area>): <summary>` or
  `feat(<pkg>): …`, `fix(<pkg>): …`. Keep the first line
  ≤ 72 chars.
- **Commit body** explains the *why*. End every commit with:

  ```
  https://claude.ai/code/session_<id>
  ```

  (the harness supplies the session URL).
- **Do not amend** — always create new commits. Amending is
  destructive if the pre-commit hook failed.
- **One PR per logical unit.** Stacked PRs are tempting but in
  this repo's history have caused at least one "merged but not on
  main" bug (PRs #4-#6 merged into their predecessor branches,
  never reached main — see the PR #7 catch-up). Default to
  **base = `main`**; only stack when review genuinely benefits.

## 5. Working style

- **Plan with TodoWrite** for any task > 3 steps. Mark items
  completed as you go — don't batch.
- **One task in_progress at a time.** Update the list when the
  user redirects.
- **Prefer dedicated tools over Bash:** Read, Edit, Write, Glob,
  Grep. Bash is for shell-only operations (git, mkdir, wc, tee).
  Use `sed`/`awk` only for tasks no dedicated tool can do (e.g.
  extracting line ranges when splitting a file — documented as
  acceptable by the guide).
- **Delegate to subagents** when a task is large-context but
  doesn't need decisions. Examples:
  - Reading the full 2000+ line `requirements/` docs end-to-end
    for a critique → `Explore` agent with an under-word-count
    prompt.
  - Open-ended codebase search across many files → `general-purpose`
    agent.
- **Don't delegate decisions.** Synthesis and judgement stay with
  the main agent; write prompts that prove you've understood the
  question.

## 6. Cross-section consistency checks

When touching any of these, check all matching sections in the
same commit:

| Change | Also check |
|---|---|
| Role / capability | §2.3 matrix · §5 endpoint gates · §3 workflow descriptions |
| Schema column | §4 DDL · §5 request/response shape · §6 outbox body shape · §10 field mapping |
| New endpoint | §5 · §6.4 (is it offline-enqueuable?) · §8.5 rate limits · §11.9 secrets if it calls an external service |
| New workflow | §3 · capability matrix · scope rules · offline scope in §6.1 |
| Retention / settings | §4.3.8 `app_settings` · §7.7 · §9.3 · §11.3 cron |
| Non-functional target | §8.13 SLOs · §11.11 cost envelope |

## 7. PR review assistance

When asked to look at a PR:
- Use `mcp__github__pull_request_read` with `method: get_diff` /
  `get_files` / `get_review_comments` rather than fetching the
  branch locally unless you need to run something.
- Post comments only when genuinely necessary (see the repo's
  GitHub Integration notes at the top of the system prompt).

## 8. Things to not do

- Don't create `*.md` docs the user didn't ask for. Work from
  conversation context.
- Don't add emojis unless the user is using them first.
- Don't commit `.env`, `.apk`, or other large binaries. The
  existing `Navshayog-4.5.2.apk` is intentional; no new binaries.
- Don't rotate `Navshayog-4.5.2.apk`'s Google Maps API key in
  place — that's the vendor's artefact and is documented as
  "rotate before public release" of the bespoke app.
- Don't force-push to `main`. Don't delete branches on `origin`
  without explicit permission (and even then, expect the git proxy
  may 403 the delete — ask the user to clean up via GitHub UI).

## 9. When in doubt

Ask. This is a small repo with a single maintainer; the cost of
a clarifying question is near-zero and the cost of shipping the
wrong thing is high. One-line exploratory questions like "A or B?"
with a one-line recommendation are welcome.
