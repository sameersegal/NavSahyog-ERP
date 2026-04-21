[← §8 Non-functional](./08-non-functional.md) · [Index](./README.md) · [§10 Migration →](./10-migration.md)

---

## 9. Compliance

### 9.1 NSNOP — child data
- **Do not collect child Aadhaar.** The vendor schema has
  `student.aadhaarNo`; the bespoke schema **removes it from both UI
  and D1**. Migration drops any data present in that column.
- Child PII stored: first name, last name, gender, DOB, school,
  village, photo, program join date, optional graduation date/reason.
- No medical, caste, religion, or income fields.

### 9.2 Parent data
- Parent Aadhaar is collected but **masked in the UI** (last 4 digits
  only) and access-logged. Not included in routine exports.
- Phone numbers validated as Indian (`+91` optional prefix, 10 digits).
  Smartphone flag is informational only.
- Alternate contact requires a relationship label.

### 9.3 Data retention
- **Out-of-system.** Retention timelines for student records and
  media are managed by ops, not by this application. The app does
  not run a retention cron and does not store a retention-policy
  configuration. See decisions.md D1/D4.
- Implications: graduated students stay queryable via the
  graduated-at column (`graduated_at IS NOT NULL`); hard deletion is
  an ops action against D1, not a scheduled Worker. Media R2
  objects are lifecycled on the bucket itself.
- Audit-log retention stays an open ops question (§11.12) — it's a
  policy, not an app setting.

### 9.4 Audit trail
- Every write stamps `created_by/at`, `updated_by/at`,
  `deleted_by/at` (soft delete).
- Append-only `audit_log` table records: login, password change,
  OTP issue/verify, failed login, user create / role change, data
  export, donor-update drafts (§3.9).
- Readable only by Super Admin.

### 9.5 Security baseline
- HTTPS only (Cloudflare-enforced).
- Passwords hashed with Argon2id in the Worker.
- R2 presigned URLs are scoped to a single object and expire in
  ≤ 15 minutes.
- **Rotate the Google Maps API key** (currently baked into
  `index.html` in the vendor APK) before any public release.
- No third-party analytics; use Cloudflare Web Analytics.

### 9.6 Open items for stakeholder confirmation
- [x] Which languages are actually in field use? **Resolved April
      2026: en + hi for launch; additional languages added on
      demand via the i18n catalogs. See §3.8.6.**
- [ ] Are `Territory` and `Taluk` geo levels populated in production
      data?
- [ ] Audit-log retention period.
- [ ] iOS required at launch, or Android + PWA only?
- [ ] Play Store APK distribution required, or is PWA install enough
      for field staff?
- [ ] Exact AF → Cluster relationship (is an AF always 1:1 with a
      cluster, or can one AF cover parts of multiple clusters?).
