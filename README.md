# NavSahyog ERP

A bespoke enterprise application for [NavSahyog
Foundation](https://www.navsahyog.org/), an Indian NGO running
child-development programs across villages in multiple states.

**Status:** requirements v1 complete · MVP L1 scaffolding landed
(lab build, dummy data). See [`mvp/`](./mvp/README.md) for the
five-level MVP ladder we're working through.

## Why this project exists

NavSahyog currently uses a generic white-label NGO platform from an
external vendor. The vendor app is built for
multi-tenant flexibility: 35 master tables, 286 backend operations,
a runtime role matrix, six preloaded languages, and tenant-level
feature flags. NavSahyog pays for all of that and uses only a small
subset.

This repository holds the specification — and, eventually, the code —
for a **single-tenant, India-only, NavSahyog-specific replacement**
on the Cloudflare stack. Goals in priority order:

1. Own the app end-to-end. Eliminate vendor lock-in.
2. Cut recurring cost. Target ≈ $25–30/month at launch scale.
3. Preserve every field-user workflow at parity with the current app.
4. Work reliably on low-end Android phones over intermittent rural
   connectivity.
5. Migrate all existing data without loss.

## Technology

Frontend React PWA on **Cloudflare Pages**, backed by
**Workers** (TypeScript REST API), **D1** (SQLite), **R2** (media),
**Queues** (offline-upload retry, retention sweeps), **KV** (sessions,
OTP). Android + PWA first; iOS is a later decision.

Concrete bindings, cron schedules, CI/CD flow, and cost envelope
are in [`requirements/11-cloudflare-mapping.md`](./requirements/11-cloudflare-mapping.md).

## Documentation

Start with the specification index:

- **[`requirements/`](./requirements/README.md)** — the specification,
  one file per section (§1 Overview → §11 Cloudflare mapping).
- **[`requirements/review-findings-v1.md`](./requirements/review-findings-v1.md)** —
  first-pass critical review. Lists blockers, gaps, over- and
  under-specification, and factual issues to resolve in the team
  review meeting before implementation begins.
- **[`NSF-App-Process-Document-English.txt`](./NSF-App-Process-Document-English.txt)** —
  the NGO's own user-training doc. Authoritative source for
  field workflows; requirements must agree with it.

The vendor app under replacement (`Navshayog-4.5.2.apk`, package
`io.ionic.ngo`) is in the repo for reference only.

## Local development (MVP L1)

```
pnpm install
pnpm --filter @navsahyog/api db:apply   # create D1 schema in .wrangler local store
pnpm --filter @navsahyog/api db:seed    # load dummy cluster + users
pnpm dev                                 # starts Worker on :8787 and Vite on :5173
```

Seeded logins (all password `password`):
`vc-anandpur`, `vc-belur`, `vc-chandragiri`, `af-bid01`,
`cluster-bid01`, `super`.

## Contributing

See [`CLAUDE.md`](./CLAUDE.md) if you are working with a Claude
agent. It lists the editing conventions, branch and PR rules, and
the cross-section consistency checks that keep the spec coherent.

For human contributors:

- Branch off `main` with a clear name. One PR per logical change.
- Requirements section numbering (`§X.Y`) is stable — don't
  renumber; use sub-numbering when adding content.
- If a change affects roles, schema, or workflows, update every
  dependent section in the same commit. The table in `CLAUDE.md`
  lists the dependencies.
- Open issues and PRs against the
  [`sameersegal/NavSahyog-ERP`](https://github.com/sameersegal/NavSahyog-ERP)
  repository.
