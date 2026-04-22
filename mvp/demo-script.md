# Demo-video recording guide

[← Index](./README.md)

One clip per landed MVP level. Narration comes from a TTS
model, not a human — the script file *is* the source of
truth; re-render the voiceover any time the script changes.

## Conventions

- **Lab-only, dummy data.** Never record a screen with real PII.
  L5 gates the move off dummy data; until then, any recording
  uses seeded rows only (`db/seed.sql`).
- **One clip per landed level.** Current scope: L1, L2, L2.5.
  L3 / L4 / L5 get their own entries when they land.
- **Hard cap 45 seconds per clip; target 40s.** Word counts in
  this file are sized for ~140 wpm Indian-English TTS with
  breathing room. Don't pad; re-record.
- **Silent video + TTS audio muxed in post.** Script → audio →
  mux. Means any contributor can regenerate a clean voiceover
  when a level changes, without re-capturing the screen.
- **Viewport:** 1440×900 for desktop clips (L1, L2); 375×812
  (iPhone 13 mini, Chrome device emulation) for L2.5.
- **Browser:** Chrome, default theme, extensions disabled,
  notifications off, a clean profile.

## Prereqs

```
pnpm install
pnpm db:reset && pnpm db:seed
pnpm dev                          # api on :8787, web on :5173
```

Seeded logins (all `password`, per `db/seed.sql`):

| Role           | user_id         |
|---             |---              |
| VC             | `vc-anandpur`   |
| AF             | `af-bid01`      |
| Cluster Admin  | `cluster-bid01` |
| District Admin | `district-bid`  |
| Super Admin    | `super`         |

## TTS tooling

Default: **Microsoft Edge TTS** (free CLI, good
`en-IN` + `hi-IN` voices). One-time install:

```
pip install edge-tts
```

Voices worth trying:

| Language       | Voice                                         |
|---             |---                                            |
| Indian English | `en-IN-NeerjaNeural` (f), `en-IN-PrabhatNeural` (m) |
| Hindi          | `hi-IN-SwaraNeural` (f), `hi-IN-MadhurNeural` (m)   |

Render audio from a script file (one `.txt` per level, copied
from the narration blocks below):

```
edge-tts --voice en-IN-NeerjaNeural \
         --rate -5% \
         --file mvp/recordings/l1.txt \
         --write-media mvp/recordings/l1.mp3
```

Alternative engines if quality is insufficient:

- **ElevenLabs** `eleven_turbo_v2_5` — most natural, paid.
- **OpenAI TTS** `tts-1-hd` — good, paid.
- **Google Cloud TTS** `en-IN-Neural2-*` — decent, paid.

Whatever engine, commit the *script*, not the audio.

## Recording the silent video

Three options; pick one per level.

1. **OBS Studio** — scene = fixed Chrome window at the target
   viewport, record H.264 MP4. Manual drive.
2. **Android + scrcpy** — install the PWA on a test device,
   then `scrcpy --record mvp/recordings/<level>-android.mp4`
   and drive the phone with desktop mouse + keyboard.
3. **Playwright (reproducible)** — extend the existing
   `scripts/capture-*.mjs` pattern with
   `context.newContext({ recordVideo: { dir, size } })`.
   Same pattern already powers per-level screenshots. Best
   when you expect to re-record often.

Keep the silent take a hair longer than 40s; `-shortest` in
the mux step trims the tail.

## Post-production mux

```
ffmpeg -i mvp/recordings/l1-silent.mp4 \
       -i mvp/recordings/l1.mp3 \
       -c:v copy -c:a aac -shortest \
       mvp/recordings/l1.mp4
```

Output MP4s live under `mvp/recordings/`. **Do not commit
them** — CLAUDE.md's do-not list covers large binaries. Add
`mvp/recordings/` to `.gitignore` and host the rendered
clips externally (the PR where a level landed, Drive,
YouTube unlisted — operator's call).

## Per-level scripts

Each narration block is a verbatim TTS input. Click path
describes what the viewer sees during the read.

### L1 — Multi-role skeleton  (≈ 41s)

**Click path**

1. `/` → log in as `vc-anandpur`.
2. User menu → theme → **Sunlight**.
3. User menu → language → **हिन्दी** → back to English.
4. Dashboard → tap the village tile → children list.
5. **Add child** → first name, last name, gender, DOB → Save.
6. Attendance → mark all present → Submit.
7. Log out → log in as `cluster-bid01` → dashboard now lists
   every village in the cluster.

**Narration (≈ 97 words)**

> Level One is the multi-role skeleton on dummy data.
> We log in as a Village Coordinator. Switch to the Sunlight
> theme, designed for outdoor Android use. Flip the language
> to Hindi — every label translates.
> The dashboard shows two tiles: children and attendance,
> scoped to this one village.
> Add a child: first name, last name, gender, date of birth.
> Village is pre-filled; school comes from the seeded list.
> Mark today's attendance — one tap per child, then submit.
> Log back in as a Cluster Admin. Every village in the cluster
> is now visible. Scope is enforced on the server.

### L2 — Full write loop + drill-down dashboard  (≈ 41s)

**Click path**

1. Log in as `vc-anandpur`.
2. Attendance → event picker → pick a seeded event.
3. Date = today −1, set start / end time, record voice note →
   Submit.
4. Capture → upload a photo → confirm attributing village on
   prompt.
5. Achievements → **Student of the Month** → pick a child.
6. Log in as `district-bid` → dashboard → drill India → Zone
   → State → Region → District → Cluster → Village.
7. Click **CSV** at district level.

**Narration (≈ 96 words)**

> Level Two is the full write loop.
> Back as a Village Coordinator. Open Attendance — pick an
> event from the seeded list, choose a date up to two days
> back, set start and end times.
> Record a voice note. Submit.
> On the Capture screen, upload a photo. EXIF location is
> extracted; the attributing village is confirmed.
> Log a Student of the Month achievement — gold and silver
> medals behave the same.
> As a District Admin, the drill-down dashboard runs from
> India down to a single village. Five tiles. One-click CSV
> export at every level.

### L2.5 — Mobile polish + Consolidated fold  (≈ 38s)

Record at **375×812** in Chrome device emulation (iPhone 13
mini).

**Click path**

1. Log in as `super` on the mobile viewport → dashboard.
2. Filter bar: show dates stacked vertically, toggle
   **Single day**.
3. **Quick-pick search** → type `Srirangapatna` → select.
4. Scroll the children table — renders as cards, not a table.
5. Switch metric from Children to Attendance; scope stays on
   the selected village.
6. KPI strip → point at attendance %, image %, video %,
   average children, SoM delta. Trend chart refreshes.
7. Copy the browser URL on-camera to show scope + date +
   metric living in query params.

**Narration (≈ 91 words)**

> Level Two Point Five is the mobile polish pass.
> Open the dashboard on an iPhone thirteen mini. Filters
> stack vertically; every touch target clears forty-four
> pixels.
> Quick-pick search — type "Srirangapatna". Two taps from
> the India root to one village.
> Below six-forty pixels the data table becomes cards. Same
> data, mobile-first.
> The KPI strip folds in the Consolidated view — attendance,
> image, and video percentages, average children, and Student
> of the Month delta. A six-month trend chart. Scope, date,
> and metric all live in the URL.

## Shipping checklist (per clip)

- [ ] Only dummy data on screen; no real PII anywhere.
- [ ] Viewport matches (1440×900 or 375×812).
- [ ] Cursor moves deliberately; no trails, no stray
      notifications / tab bells.
- [ ] Rendered TTS audio ≤ 45 s; target 40 s.
- [ ] Muxed MP4 has clean audio, no clipping, no desync.
- [ ] File saved under `mvp/recordings/` (gitignored); not
      committed.
- [ ] Link posted in the PR body for the level, or attached
      to `mvp/README.md` — whichever the operator prefers.
