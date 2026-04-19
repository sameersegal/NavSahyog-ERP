# NavSahyog ERP — Requirements

Status: **complete draft v1**, under review.

This folder holds the requirements for replacing the NavSahyog vendor
app (`Navshayog-4.5.2.apk`, package `io.ionic.ngo`)
with a bespoke ERP on the Cloudflare stack.

## How the doc is split

One file per major section. The spec was originally drafted as a
single 2 000-line `REQUIREMENTS.md` and has since been split for
easier review and editing. Section numbers (§1 – §11) are
preserved in prose so inline cross-references still make sense.

## Contents

| # | Section | File |
|---|---|---|
| 1 | Overview & goals | [`01-overview.md`](./01-overview.md) |
| 2 | Users & roles | [`02-users-and-roles.md`](./02-users-and-roles.md) |
| 3 | Functional requirements | [`03-functional.md`](./03-functional.md) |
| 4 | Data model | [`04-data-model.md`](./04-data-model.md) |
| 5 | API surface | [`05-api-surface.md`](./05-api-surface.md) |
| 6 | Offline & sync | [`06-offline-and-sync.md`](./06-offline-and-sync.md) |
| 7 | Media handling | [`07-media.md`](./07-media.md) |
| 8 | Non-functional | [`08-non-functional.md`](./08-non-functional.md) |
| 9 | Compliance | [`09-compliance.md`](./09-compliance.md) |
| 10 | Migration | [`10-migration.md`](./10-migration.md) |
| 11 | Cloudflare mapping | [`11-cloudflare-mapping.md`](./11-cloudflare-mapping.md) |
|  | Appendix — status & next steps | [`appendix-status-and-next-steps.md`](./appendix-status-and-next-steps.md) |

## Review docs

| Doc | Purpose |
|---|---|
| [`review-findings-v1.md`](./review-findings-v1.md) | First-pass critical review. Blockers, gaps, over/under-specification, and factual issues flagged for the team meeting. Resolve these before implementation begins. |

## Consolidated open items

Every `[ ]` item scattered across §4.5, §5.17, §6.13, §7.9, §8.14,
§9.6, §10.11, and §11 is already collected in
[§11.12](./11-cloudflare-mapping.md) — "Consolidated open items".
Use that as the stakeholder-meeting checklist.

## Working with these docs

- Edit any single section without touching the others.
- Section numbering (§4.3.7, §6.5, etc.) is stable. Do not renumber
  when adding content; use sub-numbering (§4.3.7.1) instead.
- Cross-references stay as plain "§X.Y" text. Readers navigate via
  this index.
- HANDOFF.md at the repo root documents how the draft was produced
  (5 parts, stacked PRs). It is historical context, not a spec.
