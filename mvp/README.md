# MVP roadmap

A parallel track to `requirements/`. The requirements describe the
**full target**; this folder describes a **five-level ladder of
MVPs** that incrementally approach it.

The two tracks are orthogonal:
- Requirements section numbering (§1 – §11) is stable and is the
  canonical reference for *what each feature should ultimately be*.
- MVP levels describe *which subset we build next*, in what order,
  under what simplifying assumptions.

MVP files reference requirements sections by plain `§X.Y` text so
both docs can evolve independently.

## Working assumptions

- **Lab-only, dummy data.** No field users, no real child PII, no
  migration target (yet). We are figuring out the approach, not
  shipping to production.
- **Auth and compliance are deferred** to the last level because
  they only matter once real data is involved.
- **Offline is deferred** because bad connectivity is not a current
  constraint; we ship it in L4 to prove the architecture, not to
  solve a field problem.
- **Multi-role + dashboards are pulled forward** because role /
  scope is load-bearing for every other feature and dashboards are
  how stakeholders evaluate progress.

## The ladder

| Level | Theme | File |
|---|---|---|
| 1 | Multi-role skeleton, one cluster | [`level-1.md`](./level-1.md) |
| 2 | Full write loop + full drill-down dashboards | [`level-2.md`](./level-2.md) |
| 2.5 | Dashboard polish (mobile-first) + §3.6.2 fold | [`level-2.5.md`](./level-2.5.md) |
| 3 | Master CRUD + secondary screens | [`level-3.md`](./level-3.md) |
| 4 | Offline mode | [`level-4.md`](./level-4.md) |
| 5 | Auth + compliance hardening (gated on approach decision) | [`level-5.md`](./level-5.md) |

## Rules

1. **Each level is shippable in isolation.** A level ends with a
   demo-able build, not a half-finished feature.
2. **Later levels replace, not extend, trivial earlier stand-ins.**
   L1 uses plain-text passwords; L5 replaces that with Argon2id.
   Don't carry "temporary" hacks forward silently.
3. **Requirements sections referenced by a level are in scope for
   that level.** Anything not referenced is deferred by default.
4. **When a level lands, update the level file with a "Status"
   line.** No separate changelog.
