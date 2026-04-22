# L2.4b — media pipeline backlog

[← Level 2](./level-2.md) · [Index](./README.md)

**Status:** pending. Promoted to a visible row on the MVP ladder
in decisions.md D16 so it doesn't orphan when L2 closes.

Follow-up work deferred during L2.4 per `requirements/decisions.md`
D7–D11. L2.4 shipped a single-PUT media pipeline with a uniform
50 MiB cap across photo, voice-note, and video so the capture UX
could stay whole. This file tracks what the decisions pushed out.

**This doc is a working list, not the spec.** Mark items
`fixed in <commit/PR>` as they land; when everything here ships,
the file becomes the L2.4b status record like any other level doc.

## Priorities at a glance

| # | Item | Trigger | Size | Unblocks |
|---|---|---|---|---|
| P1.1 | Client video transcode (ffmpeg.wasm) | Field recordings > 50 MiB raw | L | §7.8 acceptance |
| P1.2 | R2 multipart + resume | Paired with P1.1 | M | Uploads > 10 MiB on flaky links |
| P2.1 | `media-derive` Queues consumer + thumbnails | List payloads too large or slow | M | §7.4, §7.5 `thumb_url` budget |
| P2.2 | EXIF GPS extraction from source JPEGs | User picks existing file | S | §3.4.1 preferred GPS path |
| P3.1 | AWS4 presigned URLs | First production deploy | M | §8.13 "≤ 2 KiB through Worker per upload" |
| P3.2 | MP4 / Matroska GPS sidecar | Forensic audit requirement firms | S | §7.2 forensics backup |

Size: **S** ≤ half a day; **M** a day or two; **L** multi-day (new
deps, material UX surface).

---

## P1 — Unblock real-world video content

P1.1 and P1.2 **must ship together**. Shipping one without the other
either lifts the cap without a working large-file upload path (P1.1
alone) or invests in a chunked upload path with nothing to chunk
(P1.2 alone). Treat as one slice.

### P1.1 — Client video transcode (ffmpeg.wasm)

**Spec:** §7.2 ("mandatory transcode on device to 720p / ≤ 2 Mbps if
source > 50 MiB"), §7.8 acceptance ("5-min 1080p → ≤ 75 MiB H.264
720p in ≤ 2× real time; 3G upload ≤ 5 min").

**Why deferred (D8):** ffmpeg.wasm is ~30 MiB of JS + wasm. Loading
it on `/capture` page entry is not free; lazy-loading on
"Record video" press is doable but introduces a visible wait.
L2.4's 50 MiB hard cap makes transcode moot for short lab clips.

**Scope:**
- Lazy-load ffmpeg.wasm on first video capture.
- Transcode to H.264 + AAC, 720p, 2 Mbps target on any source > 50
  MiB (or configurable threshold).
- Progress UI — opaque spinner is not enough for multi-minute
  transcodes; show a percentage.
- Preserve EXIF / container GPS across transcode (ffmpeg's
  `-map_metadata 0` covers this for most codecs).

**Acceptance:** §7.8 target hit on a mid-range Android phone with a
reference 5-minute 1080p capture.

---

### P1.2 — R2 multipart + resume

**Spec:** §7.3 step 4 ("Objects > 10 MiB: R2 multipart. The presign
response returns `{ upload_id, part_urls: [...] }` pre-signed for 6
parts by default; additional parts are obtained via
`POST /api/media/presign/parts` with the `upload_id`").

**Why deferred (D9):** the 50 MiB cap from D7 fits single-PUT.
Multipart is pure net cost (more endpoints, client orchestration,
resume state) until the cap lifts.

**Scope:**
- New endpoint: `POST /api/media/presign/parts` — returns part URLs
  beyond the initial 6.
- `POST /api/media/presign` response shape switches to
  `{ upload_id, part_urls[] }` when `bytes > 10 MiB`.
- Client: chunk the file, PUT each part, track ETags, retry from
  last good part on transient failures.
- Error UI per §7.8: "surface a clear error banner if all retries
  exhausted. No silent drop."

**Acceptance:** interrupting a 30 MiB upload mid-transfer and
resuming produces a byte-identical R2 object; `media_uuid` remains
stable across the retry.

---

## P2 — UX polish, independent slices

### P2.1 — `media-derive` Queues consumer + thumbnails

**Spec:** §7.4 ("Worker consumer on the `media-derive` queue
generates 256px and 1024px WebP thumbnails; video posters at t=1s"),
§7.5 ("Dashboards and list endpoints return only `thumb_url` to
keep payload small"), §7.9 open item (Cloudflare Images vs
`wasm-vips`).

**Why deferred (D11):** no Queues binding is wired yet in
`wrangler.toml`. L2.4 list endpoints return the original R2 key as
both `url` and `thumb_url` with a TODO; correct at the contract
level, wasteful on payload.

**Scope:**
- Decide §7.9 backend:
  - **Cloudflare Images** — paid per transformation, zero ops.
  - **`wasm-vips`** — free CPU time, more code.
  - Tracked as **L6** in `requirements/review-findings-v1.md`.
- Add Queues binding (`media-derive`) to `wrangler.toml`.
- New Worker consumer: reads `media.derive` jobs, writes to
  `derived/thumb-256/{key}` and `derived/thumb-1024/{key}` (and
  `derived/poster/{key}.jpg` for video).
- On commit, enqueue a `media.derive` job (§7.3 step 5).
- List / get endpoints return `thumb_url` pointing at the 256px
  derived rendition; original key for `url`.
- Failure path per §7.4: 3× retry, then stamp
  `media.derive_failed_at` and surface in Super Admin dashboard.

**Acceptance:** §7.5 cache behaviour — thumbnails cached 1h at
edge, originals 15min. A list endpoint at P50 returns in whatever
the §8.13 budget sets.

---

### P2.2 — EXIF GPS extraction from source JPEGs

**Spec:** §3.4.1 ("the app extracts EXIF GPS from the source file
or uses `navigator.geolocation` as a fallback"), §7.6 ("the client
prefers EXIF GPS embedded in the source file").

**Why deferred:** EXIF extraction needs a parser (`exifr` at
~30 KiB gzipped, or hand-rolled reader). For a fresh camera
capture the EXIF and geolocation paths converge — browser camera
paths hit `navigator.geolocation` with live permission anyway. The
gap is only material when the user picks an *existing* file.

**Scope:**
- Add `exifr` (or minimal JPEG EXIF reader) to `apps/web`.
- In `apps/web/src/lib/media.ts`, add `extractImageExif(file)` that
  returns `{ latitude, longitude } | null`.
- `uploadMedia` and `captureGps`: prefer EXIF on JPEG when the
  source isn't a live capture; fall through to geolocation
  otherwise.
- §7.6 freshness rule: EXIF > 10 minutes old falls back to
  geolocation.

**Acceptance:** uploading a JPEG taken yesterday preserves its
original GPS stamp, not the uploader's current location.

---

## P3 — Production deploy prerequisites

### P3.1 — AWS4 presigned URLs (direct-to-R2)

**Spec:** §7.3 step 4 ("Direct PUT from the client to R2 using the
presigned URL"), §8.13 ("total bytes pushed through the Worker for
a media upload is ≤ 2 KiB per item").

**Current state:** L2.4 uses a Worker endpoint (`PUT
/api/media/upload/:uuid?token=…`) as the upload target. Bytes
transit the Worker. This was the only viable local-dev path
without real R2 credentials — see the block comment in
`apps/api/src/routes/media.ts` above the PUT handler.

**Scope:**
- Use R2's S3-compatible API (`aws4fetch` or equivalent) to mint an
  AWS4 presigned URL that points at R2 directly.
- `/api/media/presign` returns that URL instead of the worker-
  local path in production.
- Worker-local PUT endpoint stays in `--local` for dev (both code
  paths live in the same file, gated on `c.env.ENVIRONMENT`).
- Secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` via
  `wrangler secret put`.

**Acceptance:** Worker CPU time for a media upload drops to O(ms);
bytes through the Worker drop to the presign + commit request
bodies only. §8.13 measurable.

**Note:** this is deploy infra, not feature work. Tracked here so
the PUT proxy isn't mistakenly shipped to production.

---

### P3.2 — MP4 / Matroska container GPS sidecar

**Spec:** §7.2 ("for videos and audio, the client writes a
`com.navsahyog.gps` sidecar string containing `lat,lng,captured_at`
into the container metadata (MP4 `©xyz` / Matroska tag) *and*
sends the values in the `POST /api/media` body. Server trusts the
body; the sidecar is a forensics backup.").

**Why deferred (D10):** spec explicitly treats this as a backup —
the DB row is the source of truth. Writing MP4 `©xyz` atoms in the
browser is a non-trivial task with no MVP payoff.

**Scope:** in-browser MP4 box writer (mp4box.js or hand-rolled)
that injects `©xyz` and equivalent Matroska tag on the MediaRecorder
output before upload.

**Acceptance:** a recovered R2 object alone (without the DB row)
carries the GPS stamp in its container metadata.

---

## Out of scope for L2.4b

- **Audit log wiring** for media events (create / delete) —
  belongs to the §9.4 audit-log work in L5.
- **Retention sweep** — permanently dropped per D4 (out-of-system).
- **`retained_until` pin** on media — same, D1/D4.
- **Offline media capture + outbox integration** — L4. The
  `media.uuid` is already designed to double as the outbox
  idempotency key (§7.1); L4 wires the plumbing.
- **Per-village ACLs / signed read tokens per viewer** — future
  compliance work, not called out by any current requirement.

## Cross-references

- `requirements/decisions.md` D7–D11 — the calls that created this
  backlog.
- `requirements/review-findings-v1.md` L6 — derive-queue +
  thumbnail-backend decision tracker.
- `mvp/level-2.md` L2.4 row — parent slice.
