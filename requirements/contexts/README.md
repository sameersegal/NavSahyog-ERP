# Bounded contexts

The endpoint matrix at [`../generated/endpoints.md`](../generated/endpoints.md)
groups every route by **bounded context** — a coherent slice of
the domain with its own state machines, invariants, and ownership.
Each subfolder here holds the narrative content for one context:
the cross-handler invariants and gotchas that don't fit in code
comments, and aren't already covered by §3 (workflows) or
[`../decisions.md`](../decisions.md).

| Context | Has folder? | Routes |
|---|---|---|
| identity | [`./identity/`](./identity/) | auth, users |
| masters | [`./masters/`](./masters/) | geo, villages, schools, events, qualifications, training_manuals |
| beneficiaries | [`./beneficiaries/`](./beneficiaries/) | children |
| programs | [`./programs/`](./programs/) | attendance, achievements, ponds, programs *(public embed)* |
| dashboard | [`./dashboard/`](./dashboard/) | dashboard, insights, streaks |
| media | — | media |
| sync | — | sync |

`media/` and `sync/` are intentionally absent. Each is a
single-file context whose route file's header comment already
captures the rationale; creating an empty README here would be
scaffolding for its own sake. Add a folder when there's
context-spanning narrative that doesn't fit in the code header.

## What goes in a context README

- **Invariants** that span multiple handlers / files in the context
  (e.g. visibility-after-sync for offline-created children).
- **State machines / lifecycle** for entities with explicit states
  (e.g. graduation, agreement versioning).
- **Cross-context coupling** — what this context expects of others.
- **Pointers** to the spec section, decisions, and route files —
  not duplicates of them.

## What does not go here

- Workflow walkthroughs (§3 already has them).
- Per-endpoint capability/offline tables (the matrix has them).
- Decision rationale (decisions.md has it — link to the D-number).
- File-level rationale (route file headers have it).
