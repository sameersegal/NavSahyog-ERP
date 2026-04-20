# Level 5 — Auth + compliance hardening

**Status:** not started. **Gated on the team deciding to move past
dummy data.** Until that decision, L5 remains optional.

## Goal

Everything that was deferred through L1–L4 because we were in a
lab with dummy data. Nothing in this level is visible to end
users; it is entirely non-functional hardening.

## In scope

- **Password handling (§3.1, §9.5).** Argon2id hashing in the
  Worker. Password policy: min 8 chars, 1 upper, 1 digit, 1
  symbol. Default-password (`TEST*1234`) flow with forced change
  on first login; the new password must not equal the default.
- **Lockout (§3.1.1).** 3 wrong attempts → `locked_at` stamped;
  further attempts return a lockout message regardless of
  credential correctness.
- **OTP reset (§3.1.3).** 6-digit code in KV, 10-minute TTL, 5
  verify attempts, 3 OTPs per user per hour. Successful reset
  clears lockout and invalidates all existing sessions.
- **Audit log (§4.3.9, §9.4).** Writes for login success / fail /
  locked, password change, OTP request / verify, user create,
  user role change, settings update, dashboard export.
  Super-Admin read UI.
- **Retention (§9.3).** Worker cron sweeps R2 media past
  `app_settings.media_retention_days`; marks the DB row
  `deleted_at`. Student grace period after graduation (default 2
  years) documented in settings but not auto-deleted — flag the
  policy, deletion is manual pending legal sign-off.
- **Parent Aadhaar (§9.2).** Enforce masked-only storage on the
  server (reject full Aadhaar in request bodies). UI masks on
  display.
- **Geofence validation (§7).** Reject media whose GPS falls
  outside the village's `(latitude, longitude, radius_m)` by a
  configurable tolerance.
- **Key rotation (§9.5).** Replace the Google Maps API key baked
  into the vendor APK; issue a bespoke key scoped to our domains.
- **Outbox on hardened auth.** Re-test the L4 outbox drain path
  with: expired sessions, sessions revoked by OTP reset mid-sync,
  sessions revoked by Super Admin mid-sync. Add an explicit
  acceptance test for each.

## Explicitly still deferred

- Migration from vendor data (§10). There is no cutover target
  right now; revisit if that changes.
- iOS (§1.3). Decision gated on whether PWA install suffices.
- Capacitor / Play Store. Same gate.

## Acceptance

1. Seeded Argon2id password verifies on login; plain-text
   passwords from L1–L4 are migrated via a one-off Worker script
   and then the plain-text column is dropped from the schema.
2. 3 wrong attempts lock the account; a 4th correct attempt is
   still refused with the lockout message.
3. OTP request / verify flow works end-to-end against the chosen
   provider; reset invalidates an existing session in another
   tab.
4. Super Admin can view the last 30 days of audit-log entries;
   no role below Super Admin can read from the table.
5. Cron sweep deletes a test R2 object older than
   `media_retention_days`; the DB row's `deleted_at` is stamped.
6. Uploading media with forged GPS 10 km outside village
   coordinates is rejected at upload-commit time.
7. Outbox drain succeeds across a mid-sync session revocation:
   the user is prompted to re-authenticate; the outbox is not
   lost.

## Open questions

- [ ] OTP provider (confirm §11.9 secrets and vendor).
- [ ] Migration (§10) — revisit once the approach decision is
      made.
- [ ] Legal sign-off path for Aadhaar storage policy.
