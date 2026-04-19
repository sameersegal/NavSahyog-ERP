[← §6 Offline & sync](./06-offline-and-sync.md) · [Index](./README.md) · [§8 Non-functional →](./08-non-functional.md)

---

## 7. Media handling

All images, videos, and voice notes live in **R2**. D1 stores only
the metadata row (`media`, §4.3.7). The Worker never proxies bytes
— clients PUT directly to R2 using presigned URLs (§5.8).

### 7.1 R2 bucket layout

Two buckets per environment:

- **`media-prod`** — canonical storage for committed media.
- **`media-staging`** — mirror for the staging environment.

Object key convention (stable; survives row deletes):

```
{kind}/{yyyy}/{mm}/{dd}/{village_uuid}/{media_uuid}.{ext}
```

e.g. `image/2026/04/19/0194…/01HXX…ULID.jpg`.

Rationale:
- Date prefix keeps R2 listings cheap for retention sweeps.
- Village prefix aids reporting and any future per-village ACLs.
- `media_uuid` is the same ULID used as `idempotency_key` in the
  outbox (§6.3), so the key is deterministic from the client side
  without a round-trip.

### 7.2 Accepted types and size limits

| Kind | MIME | Client cap | Notes |
|---|---|---|---|
| image | `image/jpeg`, `image/png`, `image/webp` | 8 MiB raw | Re-encoded to WebP on device before upload if > 2 MiB. |
| video | `video/mp4` (H.264 + AAC) | 200 MiB raw | Mandatory transcode on device to 720p / ≤ 2 Mbps if source > 50 MiB. |
| audio | `audio/mp4` (AAC) or `audio/ogg` (Opus) | 16 MiB raw | Voice notes only; max duration 5 min (client-enforced). |

The Worker rejects commits (§5.8) with a 413 when
`bytes > app_settings.media_bytes_limit[kind]`; the client
pre-validates to avoid wasted uploads.

### 7.3 Upload pipeline

1. **Capture** → client computes SHA-256 of the file.
2. **Client transcode / compress** per §7.2. EXIF GPS is
   **preserved** for images; for videos and audio, the client
   writes a `com.navsahyog.gps` sidecar string containing
   `lat,lng,captured_at` into the container metadata (MP4 `©xyz`
   / Matroska tag) *and* sends the values in the `POST /api/media`
   body. Server trusts the body; the sidecar is a forensics
   backup.
3. **Presign** (`POST /api/media/presign`, §5.8) with the chosen
   `r2_key` and content hash. The Worker validates:
   - Kind matches the user's allowed list.
   - Caller has write scope on `village_id`.
   - Bytes within the configured cap.
4. **Direct PUT** from the client to R2 using the presigned URL.
   - Objects ≤ 10 MiB: single PUT.
   - Objects > 10 MiB: R2 multipart. The presign response returns
     `{ upload_id, part_urls: [...] }` pre-signed for 6 parts by
     default; additional parts are obtained via
     `POST /api/media/presign/parts` with the `upload_id`.
5. **Commit** (`POST /api/media`) with the final size and ETag.
   The Worker:
   - Verifies the object exists in R2 (`HEAD`) and matches the
     size/ETag from the commit body.
   - Writes the `media` row.
   - Enqueues a **`media.derive`** job on Queues for thumbnail
     generation (§7.4).
6. On client side, outbox row (§6.3) is marked `done` and the
   local blob is deleted.

### 7.4 Derived renditions

A Worker consumer on the **`media-derive`** queue generates:

- **Image thumbnails**: 256px and 1024px WebP, stored as
  `derived/thumb-256/{original_key}` and `derived/thumb-1024/…`.
  Uses Cloudflare Images binding in production (with a fall-back
  Worker that wraps `wasm-vips` for local dev).
- **Video posters**: single JPEG frame at `t=1s`, saved as
  `derived/poster/{original_key}.jpg`.
- **Audio**: no derived form; served as-is.

Failures are retried 3× with exponential backoff, then recorded
on the `media` row as `derive_failed_at` and surfaced in the
Super Admin dashboard for manual retry. The original is never
blocked by a derivation failure.

### 7.5 Delivery to clients

Reads return short-lived presigned GET URLs. Two URL flavours:

- **`url`** — original object, 15-minute TTL. Used when the user
  explicitly opens media detail.
- **`thumb_url`** — 256px WebP, 1-hour TTL. Used in list views.

Dashboards and list endpoints return only `thumb_url` to keep
payload small.

Static caching: Cloudflare Cache edges cache thumbnails by URL
for 1 hour; the TTL of the presigned URL itself is the cache
ceiling. Cache purge on delete is best-effort.

### 7.6 EXIF GPS rules

- On capture, the client prefers EXIF GPS embedded in the source
  file. If absent or stale (> 10 min old), it falls back to
  `navigator.geolocation` with `enableHighAccuracy: true`.
- The captured lat/lng is stored in **three places**:
  1. `media.latitude` / `media.longitude` in D1.
  2. The file's EXIF (images) or container metadata
     (videos/audio).
  3. The outbox row body (provenance chain for offline captures).
- If the source file lacked EXIF GPS and geolocation fails, the
  client warns the user and either records a null location
  (permitted, flagged in §7.8) or the user retakes.
- Village geofence check (optional): when `village.radius_m` is
  set, the server warns (non-blocking) if GPS is > radius from
  the village centroid, stamping `media.geo_warning = 1`.

### 7.7 Retention

- The value lives in `app_settings.media_retention_days` (default
  180).
- A daily Worker cron (`media-retention`) sweeps R2 for objects
  older than the threshold (using the `yyyy/mm/dd` prefix for
  efficient listing), deletes them, and sets `deleted_at` on the
  corresponding `media` rows.
- Derived renditions are deleted together with the original.
- Deletions are logged to `audit_log` as a single
  `media.retention_sweep` event per day with a count.
- A Super Admin can **pin** specific media (field
  `media.retained_until`) to override the retention sweep — used
  for legal holds and showcase media.

### 7.8 Acceptance criteria

- A 5-minute 1080p capture on a mid-range Android phone is
  transcoded to ≤ 75 MiB H.264 720p in ≤ 2× real time and
  uploads over 3G in ≤ 5 min.
- The total bytes pushed through the Worker for a media upload
  is ≤ 2 KiB per item (only metadata; bytes go direct to R2).
- A media row with a derivation failure still serves the original
  via `url`; the thumbnail slot gracefully falls back to a
  placeholder in the UI.
- Deleting a `media` row removes the original, all derived
  renditions, and any cached thumbnails within 24 hours.
- A presigned URL leaked to a third party expires within 15 min
  (for originals) / 60 min (for thumbnails).

### 7.9 Open items

- [ ] Is permitting null-GPS captures acceptable, or must every
      upload carry coordinates?
- [ ] Pick the thumbnail generator: Cloudflare Images (paid, per
      transformation) vs in-Worker `wasm-vips` (free, CPU time).
- [ ] Confirm video max length — 5 min is a guess; longer films
      may need chunked uploads per scene.
- [ ] Decide retention default: 180 days matches the vendor's
      default; NavSahyog may want longer for legal/showcase archives
      (consider the `retained_until` pin in §7.7 as the escape hatch).

