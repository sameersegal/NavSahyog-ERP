# Demo-video recording guide

[← Index](./README.md)

One consolidated clip for the latest build, narrated by a local
TTS model served via Ollama. The script file *is* the source of
truth — regenerate the voiceover any time the script changes.

## Conventions

- **Lab-only, dummy data.** Never record a screen with real PII.
  L5 gates the move off dummy data; until then, recordings use
  seeded rows only (`db/seed.sql`).
- **Super Admin POV, one continuous session.** No role-switching
  gymnastics — the viewer sees the product the way an oversight
  stakeholder does. Scope enforcement is demonstrated in the
  capability tests, not on camera.
- **Hard cap 45 seconds; target 40s.** Narration below is sized
  for ~140 wpm Indian-English TTS with breathing room. Don't pad;
  re-record.
- **Silent video + TTS audio muxed in post.** Script → audio →
  mux. Any contributor can regenerate a clean voiceover when the
  build moves forward, without re-capturing the screen.
- **Viewports used in the one clip:** 1440×900 desktop for the
  drill-down portion; mid-clip switch to 375×812 (iPhone 13 mini,
  Chrome device emulation) for the mobile portion.
- **Browser:** Chrome, default theme, extensions disabled,
  notifications off, clean profile.

## Prereqs

```
pnpm install
pnpm db:reset && pnpm db:seed
pnpm dev                          # api on :8787, web on :5173
```

Seeded Super Admin login (password = `password`, per `db/seed.sql`):

| Role        | user_id |
|---          |---      |
| Super Admin | `super` |

## TTS via Ollama

Ollama does not ship TTS models in its public registry today, so
you'll be serving a local TTS model behind Ollama's
**OpenAI-compatible endpoint** at `/v1/audio/speech`. Any
OpenAI-API-compatible local TTS server works the same way;
only `OLLAMA_HOST` + `model` change.

Recommended model: **Kokoro** (82 M params, ~300 MB, strong
Indian-English voices, fast on CPU). Load via a community
Modelfile or a sibling process (openedai-speech, LocalAI) that
Ollama can front.

Prepare the script file:

```
mkdir -p mvp/recordings
# paste the narration block (verbatim) into:
$EDITOR mvp/recordings/demo.txt
```

Render audio:

```
curl http://localhost:11434/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg input "$(cat mvp/recordings/demo.txt)" '{
        model: "kokoro",
        voice: "af_heart",
        input: $input,
        response_format: "mp3",
        speed: 0.95
      }')" \
  --output mvp/recordings/demo.mp3
```

- `speed: 0.95` lands at ~135 wpm for Kokoro's `af_heart` voice,
  clear and slightly paced for a demo.
- If the clip lands > 42s, drop `speed` to `1.0`; if it lands
  < 36s, raise to `0.9` for weightier cadence.
- Swap `voice` for a male Indian-English equivalent (depends
  on the voice pack your Kokoro build ships; Kokoro's
  `am_adam` / `bm_*` families are common).

Switching engines:

- **LocalAI** — same `/v1/audio/speech` path, default port 8080.
- **openedai-speech** — same path, default port 8000; supports
  Piper + XTTS.
- **Piper CLI** (no HTTP) — drop-in if you want pure local:
  `echo "$(cat mvp/recordings/demo.txt)" | piper --model en_IN-<voice>.onnx --output_file mvp/recordings/demo.wav`.

Commit the script (`demo.txt`), never the audio.

## Recording the silent video

The clip has a desktop half and a mobile half, so recording
options differ slightly:

1. **OBS Studio (manual).** Two scenes: Chrome at 1440×900,
   Chrome at 375×812 in device emulation. Scene-switch on the
   desktop → mobile transition. One continuous take.
2. **Playwright (reproducible).** Extend the pattern from
   `scripts/capture-*.mjs` — open a `context` with
   `recordVideo: { dir, size: { width: 1440, height: 900 } }`,
   drive the drill-down, then a second `context` at
   `{ width: 375, height: 812 }` drives the mobile half.
   Concatenate with ffmpeg `concat`. Best when you expect to
   re-record as the build moves.
3. **scrcpy (if recording on real Android).** Skip the mobile
   Chrome emulation; install the PWA and capture the phone.
   Worth it only when field UX specifically matters for the
   audience.

Keep the silent take a hair longer than 40s; `-shortest` in the
mux step trims the tail to TTS length.

## Click path (Super Admin, one continuous take)

Desktop half (1440×900):

1. `/` → log in as `super`.
2. Dashboard opens at India root. Pause on the five tiles —
   Village Coordinators, Animator-Facilitators, children,
   attendance, achievements.
3. Drill: India → Zone SZ → State KA → Region SK → District
   BID → Cluster BID01 → Village Anandpur.
4. At the district level, click **CSV** — brief highlight of
   the download pill.

Mobile half (375×812, Chrome device emulation, iPhone 13 mini):

5. Toggle device emulation; page reflows.
6. Quick-pick search → type `Srirangapatna` → select.
7. Scroll the children table — cards, not a table.
8. Switch metric from Children to Attendance; scope stays.
9. KPI strip — pan across attendance %, image %, video %,
   avg children, SoM delta. Trend chart visible below.
10. Highlight the browser URL bar on-camera so scope + date
    + metric query params are visible.

## Narration  (≈ 40s at 140 wpm, 95 words)

Paste this verbatim into `mvp/recordings/demo.txt`:

> NavSahyog — latest build, signed in as Super Admin.
> The drill-down dashboard opens at India. Five tiles: Village
> Coordinators, Animator-Facilitators, children, attendance, and
> achievements. Drill through Zone, State, Region, District,
> Cluster — down to one village.
> CSV export is one click at every level.
> Switch to an iPhone thirteen mini. Filters stack; quick-pick
> search reaches any village in two taps. Below six-forty pixels
> the data table becomes cards.
> The KPI strip folds in the Consolidated view — attendance,
> image, and video percentages, and a six-month trend chart.
> Scope, date, and metric all live in the URL.

## Post-production mux

```
ffmpeg -i mvp/recordings/demo-silent.mp4 \
       -i mvp/recordings/demo.mp3 \
       -c:v copy -c:a aac -shortest \
       mvp/recordings/demo.mp4
```

`mvp/recordings/` is gitignored; don't commit MP4s. Host the
rendered clip externally (PR body, Drive, YouTube unlisted —
operator's call) and link it from `mvp/README.md`.

## Shipping checklist

- [ ] Only dummy data on screen; no real PII anywhere.
- [ ] Single take, Super Admin session start-to-finish.
- [ ] Desktop half at 1440×900; mobile half at 375×812.
- [ ] Cursor moves deliberately; no trails, no stray
      notifications / tab bells.
- [ ] Rendered TTS audio ≤ 45 s.
- [ ] Muxed MP4 has clean audio, no clipping, no desync.
- [ ] File under `mvp/recordings/` (gitignored); not committed.
- [ ] Link posted in the PR body or `mvp/README.md`.
