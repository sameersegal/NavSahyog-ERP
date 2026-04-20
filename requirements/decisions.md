# Decisions

[← Index](./README.md)

Outcomes of review-findings discussions and MVP session calls. This
file is the **durable record** — the spec text is updated to match
in the same commit the decision lands. Each row has a one-line
justification.

---

## 2026-04-20 — L2 kickoff

| # | Decision | Supersedes |
|---|---|---|
| D1 | Drop the `app_settings` table entirely. Retention timelines (student records, media) are handled **outside this system** — by ops, not by a Worker cron. Anything else `app_settings` was going to hold (session TTL, default language) moves to Worker env vars or code constants. | Review-findings U5 (Add `student_retention_years` to `app_settings`), L1-review H5 (create empty `app_settings` now). Both superseded. |
| D2 | Downgrade "Excel export" (§3.6.3, §5.10) to **CSV** for L2 and L3. True `.xlsx` is deferred to L5 (if it ever returns a net win over CSV). CSV is one function, zero dependencies, and every spreadsheet tool opens it. | — |
| D3 | **Defer R2 to the end of L2** (level 2.4). L2.0–L2.3 run against local D1 only; wrangler's `--local` R2 stands up the pipeline in L2.4. Production R2 binding is deferred until the first real deploy. | — |
| D4 | **No retention cron, no retention sweep worker, no `retained_until` pin.** Both the `media-retention` cron (§7.7) and the `retention-sweep` Worker (§11.3) are removed from the spec. Media deletion is a manual ops task for the lab; a deployment-time decision for production. | — |

### Follow-on spec cleanups (same commit as D1–D4)

- §4.3.8 (data model) — section removed; `audit_log` becomes §4.3.8.
- §7.7 (media retention) — replaced with a one-paragraph note that
  retention is out-of-system.
- §9.3 (compliance retention) — rewritten to describe the
  out-of-system boundary. Audit-log retention stays as an open item
  (ops question, not app config).
- §5.13 (`/api/settings`) — endpoint removed.
- §3.8.7 (Master Creations) — `retention settings` entry removed.
- §2.3 (capability matrix) — `Retention / app settings` row removed;
  Super Admin's only remaining exclusive capability is `Manage users`
  plus master CRUD.
- §2.1 (actors) — Super Admin description no longer mentions
  "retention config".
- §10 (migration) — `legacy_settings → app_settings` row removed
  from the master-data migration list; the vendor's config is
  retained only as reference for our env-var defaults.
- §11.3 (Workers) — `retention-sweep` Worker deleted. The three
  Workers are now `api` + `derive-media` + `migrator`.
- §11.7 (Queues) — `retention-sweep-media` queue deleted.
- §11.9 (Secrets) — `GRAFANA_CLOUD_PUSH_URL` surface list drops
  `retention-sweep`.
- §11.10 (CI/CD) — `/workers/retention-sweep` removed from the repo
  layout.
- §11.12 open items — the audit-log retention item (§9.6) stays
  because that's an ops policy, not an `app_settings` knob.

---

## 2026-04-20 — L2.3 PR #24 review

| # | Decision | Supersedes |
|---|---|---|
| D5 | **CSV exports carry no context line.** §3.6.3 says "CSV mirrors the on-screen table exactly". Inline `# India > Zone > …` comments are not RFC-4180 comments — Excel and pandas treat `#` as data, so the trail surfaces as a rogue one-cell row. Context lives in the **filename** instead: `<metric>_<level>[_<crumb>][_<from>_to_<to>].csv`. Two downloads from the same page with different scope or period therefore land as distinct files, not overwrites. | Earlier L2.3 draft that prepended `# trail` to each CSV. |
| D6 | **CSV cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` are prefixed with `'` before emit.** CWE-1236 (formula injection). Achievement descriptions are free-form VC input and the CSV is the only artefact users open in a spreadsheet. The single-quote prefix is interpreted as a text marker by Excel / Sheets / LibreOffice (not rendered in most views) and is safe literal data for programmatic CSV parsers. | — |

---

## How to use this file

- **Add a row at the top** (reverse-chronological) when a review
  meeting or working session produces a new decision.
- **Update the spec in the same commit.** If a decision touches §X
  and §Y, both sections change together with the `decisions.md`
  update.
- **Don't reopen.** If a decision needs to be revisited, add a new
  row that supersedes it explicitly, and re-edit the spec. The old
  row stays (with its date) for history.
