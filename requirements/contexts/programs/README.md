# programs

The four program-shaped resources: attendance, achievements,
ponds (Jal Vriddhi), and the public embed surface.

- Routes: attendance, achievements, ponds, programs *(public)*
- Spec: §3.3 (attendance), §3.4 (achievements), §3.10 (Jal Vriddhi)
- Decisions: D25–D28 (ponds), D29–D32 (offline platform), D35
  (children create — affects every program's picker)

## Per-resource invariants

### Attendance (§3.3)
- **Idempotent UPSERT on `(village_id, date, event_id)`.**
  Submitting the same triple replaces the marks; the outbox
  wrapper around `withIdempotency` returns a byte-identical
  response on key replay.
- **Three-day backfill window:** today, today − 1, today − 2 only.
  Any other date is a 400. Captured via `windowReject()` in
  [`attendance.ts`](../../../apps/api/src/routes/attendance.ts).
- **Voice notes reference media that must be uploaded first.**
  `voice_note_media_id` is validated against a live audio media
  row in the same village before the session is committed.

### Achievements (§3.4)
- **SoM (Student-of-the-Month) uniqueness is enforced
  server-side.** A second SoM for the same `(student, month)`
  conflicts on insert; the outbox surfaces the failure in the
  dead-letter UI rather than retrying.
- The achievement picker depends on `cache_students` — see
  D35 / [`../beneficiaries/`](../beneficiaries/) for the
  visibility-after-sync rule that affects what the picker shows
  offline.

### Ponds — Jal Vriddhi (§3.10, D25–D28)
- **Online-only by D25.** The agreement scan is the high-stakes
  artefact; better to fail fast on a bad-network day than risk a
  placeholder version.
- **Append-only versioning** (D26). Re-uploading creates a new
  `pond_agreement_version` row with `version = MAX(version) + 1`;
  the prior R2 object stays in place. There is no PATCH or DELETE
  on a version.
- **Dedicated HMAC token machinery** (D27) — agreement uploads do
  not share the media token. Distinct version marker
  (`agreement-v1`) prevents replay across surfaces.
- **Read access is broad, write is village-scoped** (D28). Any
  authenticated role can view the agreement trail; any user with
  `pond.write` whose effective scope covers the pond's village
  can append a version.

### Public embed (`programs.ts`, §3.10)
- **No auth, no cookies, CORS open.** Strict PII allowlist on the
  wire — see the file header for the full list. Coordinates
  rounded to 3 decimals (~110 m) so an exact plot can't be
  pinpointed; village-scale clustering still works.
- Adding a new program = a sibling endpoint under this router.
  Move to a sub-folder once the count grows past ~3.

## Cross-context coupling

- **Every program write depends on identity (auth) and
  beneficiaries (cached students).** A degraded manifest pull
  silently degrades the picker UX; the offline-required workflows
  still queue but the user may have to wait for cache reseed
  before the picker reflects new entries.
- **Attendance + achievements both ride the `withIdempotency`
  wrapper** and the outbox runner orchestrating their POSTs is the
  same code path — see `apps/web/src/lib/drain.ts`.
