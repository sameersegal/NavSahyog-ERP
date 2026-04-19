# Requirements — Review Findings v1

[← Index](./README.md)

**Purpose.** This doc captures the first-pass critical review of
`requirements/` before the team meeting. It is **not** part of the
spec — it's a working list of issues to resolve, with proposed fixes
and decision prompts.

**Scope.** Covers sections 1–11 of the requirements. Based on a
structured read against the HANDOFF design principles (bespoke vs.
vendor-generic, single-tenant, India-only, PWA on Cloudflare) and
the NGO onboarding doc `NSF-App-Process-Document-English.txt`.

**How to use in the meeting.** Walk the four lists below in order
(Blockers → High → Medium → Low). Each item gives the problem,
where it lives in the spec, and a proposed fix. Decisions go into a
follow-up addendum PR — don't edit the spec during the meeting.

---

## Severity legend

- **BLOCKER** — must be resolved before implementation begins. The
  spec contradicts itself or omits a required decision.
- **HIGH** — resolve before the relevant section is touched in code.
  Leaving these unresolved creates rework.
- **MEDIUM** — should be resolved, but work can progress. Usually
  over- or under-specification that bogs down reviewers.
- **LOW** — polish. Fix when convenient.

---

## 0. Fixed during this review

- **§9 Compliance body was silently dropped** when Part 2 was written
  on top of Part 1. The TOC listed it as ✅ but the body was missing,
  leaving **26+ cross-references dangling** (every reference to
  §9.1 "no child Aadhaar", §9.3 retention, §9.4 audit, §9.5 security,
  §9.6 open items). Restored from the Part 1 commit
  (`3a7040f`) as part of the split into this folder. Verify nothing
  has drifted since — the restored text is the original Part 1
  content only.

---

## 1. BLOCKERS

### B1 — Graduate-child offline/online policy is contradictory
- §2.3 capability matrix grants VCs the "Graduate child" write.
- §3.7 lists the three offline workflows (attendance, achievements,
  media) and says "Other menu items are hidden or disabled."
- Graduate Child is not one of the three — but it is not explicitly
  excluded either. A developer reading §3.2.4 alone will assume it
  works offline like edit.
- **Fix.** Add one sentence to §3.7: _"Graduation is online-only.
  Offline mode disables the Graduate button and shows a tooltip."_
  No schema change needed.

### B2 — Offline student-creation: allowed or not?
- §6.1 says **only three** workflows are offline.
- §6.6 says _"Student creation offline is allowed"_ as part of
  conflict resolution.
- §6.13 lists this as an open item.
- Three sections, three positions. Must be one answer.
- **Decision prompt.** Allow offline student add (more field
  flexibility; adds placeholder-ID resolution complexity for
  downstream achievements) OR require online (cleaner sync; blocks
  a VC on a bad-network day). **Recommendation: online-only.** Child
  registration is rare relative to attendance and benefits from
  real-time parent-Aadhaar validation (§9.2).
- **Fix if online-only.** Delete the allowance in §6.6 and simplify
  the outbox placeholder-ref machinery in §6.3 — no achievements
  will ever reference a client-only student ID.

### B3 — District+ write access is not consistent
- §2.3 matrix shows District / Region / State / Zone admins are
  **read-only** for all operational writes.
- §5.6 and §5.9 describe gates as "`cluster_admin` or higher" —
  which includes District+ by rank. Endpoints currently let them
  write.
- **Fix.** Replace every "role ≥ threshold" phrasing in §5 with an
  explicit allow-list (`vc | af | cluster_admin | super_admin`).
  Update §5.17 to close the open item.

---

## 2. HIGH

### H1 — AF ↔ Cluster cardinality blocks the scope model
- §2.1 describes AFs as covering "multiple villages in a cluster."
- §4.3.1 puts `scope_level` + `scope_id` on the user row, implying
  each user anchors to one node.
- §11.12 still lists this as unresolved.
- If AFs can span clusters, the single-anchor model breaks. Impacts
  pickers (§3.2.1, §3.4.3) and every scope check (§5.*).
- **Decision prompt.** Confirm with NavSahyog ops: **1 AF : 1 cluster**
  (recommended — simplest) or **many : many** (requires a
  `user_scope` junction table).
- **Fix path A.** Keep §4.3.1 as-is; add a note: "one AF = one
  cluster."
- **Fix path B.** Replace `scope_id` with `user_scope(user_id,
  scope_level, scope_id)`. Re-audit every scope check.

### H2 — Sync manifest granularity is still TBD
- §5.14 and §6.9 both describe a single `/api/sync/manifest?since=`
  endpoint returning all resource types.
- §5.17 and §6.13 mark this as an open choice (single vs.
  per-resource).
- Blocks the client cache design and the edge-cache key shape.
- **Decision prompt.** Single endpoint (one request, one
  cache key, simpler client) or per-resource (independently
  cacheable, easier to paginate).
- **Recommendation: single endpoint.** Scope-filtered payload is
  already small (§6.10 target ≤ 500 KiB gzipped).

### H3 — Cross-workflow offline references
- If B2 resolves as "offline student creation allowed" (not the
  recommendation): §6.3's outbox `body` must resolve client ULIDs
  to server UUIDs during drain. §5 doesn't say which endpoints
  accept placeholder IDs.
- If B2 resolves as "online-only": this whole issue goes away.
- **Fix.** Drop placeholder-ref language from §6.3 unless B2 goes
  the other way.

### H4 — Migration vs. onboarding-doc training
- §10 plans to force all users to reset passwords during cut-over
  (because the vendor hash is "likely incompatible").
- The onboarding doc explicitly trains users to **re-enter
  `TEST*1234`** on the first forced-change prompt, not to pick a
  new password.
- A mass reset + new password policy right at cut-over will create
  a support spike.
- **Fix.** Add a row to the §10.10 risk table: staged per-cluster
  reset starting **14 days before cut-over**, with out-of-band
  comms to each AF. Keep onboarding doc wording accurate by issuing
  updated training materials before wave 1.

### H5 — Event ↔ Activity merge: semantic parity, not just schema parity
- §4.3.4 merges both into a single `event` row with `kind`.
- §3.4.2 keeps the two pickers in UI, mapped by `kind`.
- The concern: if an admin changes `event.kind` from `activity` to
  `event` (or vice versa) mid-year, previously tagged media and
  attendance rows silently change category.
- **Fix.** Add to §4.3.4: _"`event.kind` is immutable once the row
  has any referencing media or attendance. Changing it requires
  Super Admin to create a replacement row and re-tag."_

---

## 3. MEDIUM — over-specification to strip

The spec states specific tuning values and toolchain picks that
belong in a separate `DEFAULTS.md` / `DECISIONS.md` addendum, not
in the requirement text. Extracting these lets the spec state
_what_ and the addendum state _how_.

| Item | Location | Current (implementation detail) | Keep in spec |
|---|---|---|---|
| Argon2id `t=2, m=19456, p=1` | §8.3 | Specific params + `ARGON2_PEPPER` secret | "Memory-hard hash, configurable params, global pepper" |
| Session TTL 12h, OTP 10min, presign 15/60min, idempotency 24h | §8.4 | Exact numbers | "Configurable; operational defaults documented separately" |
| JS budget 180 KiB / CSS 20 KiB / HTML 8 KiB | §8.2 | Exact numbers, specific tooling (size-limit) | "First-load budget enforced in CI" |
| React + Vite, pnpm, drizzle-kit, Workbox, Grafana Cloud | §11.2, §11.10, §8.8 | Named tools | "SPA framework TBD; one i18n composite font; PWA Service Worker; metrics backend TBD" |
| Cron `0 2 * * *` | §11.3 | Exact schedule | "Daily, off-peak IST" |
| Argon2 pepper, OTP provider enumerated (MSG91/Twilio/Kaleyra) | §11.9 | Named providers | "OTP provider TBD (§11.12 open item)" |

**Fix.** One addendum doc — `requirements/defaults.md` — that lists
every concrete default with a one-line justification. The spec
files link to it.

---

## 4. MEDIUM — under-specification to tighten

### U1 — Device-level concurrency is implicit
- §6.12 says outbox is device-local. Good.
- No acceptance criterion covers "User logs in on Device B —
  what happens to Device A's outbox?"
- **Fix.** Add to §6.12: _"Outbox is device-local. A second device
  signed in as the same user has an independent outbox; both
  drain independently; server dedupes via `Idempotency-Key`."_

### U2 — SLO denominator
- §8.13 "outbox drain success rate ≥ 98 %" — per item, per run,
  per user, per day?
- **Fix.** Write: _"per (user, UTC day), counted as items
  successfully committed / items enqueued that day."_

### U3 — Language-switcher conflict
- §3.8.6 stores language in both KV (server) and localStorage (client).
- No rule for which wins on conflict.
- **Fix.** _"Server value wins on login; client overrides are
  persisted on the next authenticated request."_

### U4 — `scope_id` has no DB-level FK
- §4.3.1 — enforced in application code only.
- **Fix.** Either (a) accept the soft invariant and document it
  explicitly in §4.1 conventions, or (b) move to a junction table
  (pairs with H1 path B).

### U5 — Student retention grace period is orphan config
- §9.3 mentions a "configurable grace period (default: 2 years
  after graduation)."
- §4.3.8 `app_settings` has no field for it.
- **Fix.** Add `student_retention_years INTEGER NOT NULL DEFAULT 2`
  to `app_settings` in §4.3.8.

### U6 — Idempotency: required vs. tolerated
- §5.1 says all POST/PATCH accept `Idempotency-Key`.
- Doesn't say whether it's required. Outbox definitely requires it;
  a direct-online POST doesn't.
- **Fix.** Add: _"Mandatory for `/api/sync/outbox` items;
  optional but recommended for direct POST/PATCH."_

---

## 5. LOW

- **L1.** §7.7 retention discussed in §9.3 and §7.7 with slight
  wording drift. Consolidate in §9.3 and leave §7.7 as a pointer.
- **L2.** §2.2 says Country is fixed as India — but the schema
  (§4.3.2) has no `country` table. That's correct but not called
  out. Add one line to §4.3.2: "Country is hardcoded to India; no
  `country` table."
- **L3.** §5.8 `/api/media/presign` returns a multipart init token
  "when `bytes > 10 MiB`"; §7.3 says "Objects > 10 MiB". Same
  threshold, but spelled out separately in each. Pick one.
- **L4.** §10.5 uses `LoginId` / `PwdHash` / `CorpId` in
  PascalCase quoting the vendor; all other references use snake_case.
  Pick one convention and footnote.
- **L5.** §11.11 cost envelope labels Cloudflare Images as "if
  used" and then §11.3 binds it. Decide and align.

---

## 6. Decisions needed (ordered for the meeting)

Run the team meeting against this list. Each row is a go/no-go
input for implementation.

1. **B1** Graduate online-only? ✅ / ✏️
2. **B2** Offline student creation: online-only or allowed offline?
3. **B3** District+ admins: strictly read-only?
4. **H1** AF ↔ Cluster: 1:1 or many:many?
5. **H2** Sync manifest: single endpoint or per-resource?
6. **H5** Immutable `event.kind` once referenced?
7. **H4** Password-migration staging plan: how many waves, how
   long, who owns comms?
8. §9.6 open items (languages, Territory/Taluk populated, audit
   retention, iOS, Play Store, AF cardinality — overlaps H1).
9. §4.5, §5.17, §6.13, §7.9, §8.14, §10.11, §11.12 remaining
   items (mostly covered above; see §11.12 for the full list).

---

## 7. Next steps after the meeting

1. Land decisions in `requirements/decisions.md` (new doc,
   dated).
2. Split `requirements/defaults.md` out from §§8 and 11
   (Medium-over-specification fix).
3. Edit each affected section of the spec to reflect decisions;
   one PR per section to keep reviews tractable.
4. Once all Blockers and Highs are closed, tag `requirements/`
   as `v1.0-signed-off` and begin the first vertical slice (per
   appendix): `/auth/login` + `/api/children`.
