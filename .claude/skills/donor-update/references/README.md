# Donor update — 1-pager PDF (skill references)

A single-page A4 infographic the operator can attach to a WhatsApp
message or email for a donor. Built from a JSON data file + one of
three theme templates; rendered to PDF + PNG preview via Playwright.

This directory is a skill reference bundle — everything the
`donor-update` skill needs to produce a PDF lives here. The skill
itself is defined one level up in `SKILL.md`.

## Files

```
.claude/skills/donor-update/
├── SKILL.md                         ← agent instructions (one level up)
└── references/                       ← you are here
    ├── render.mjs                    ← Playwright-driven HTML → PDF + PNG
    ├── base.css                      ← page geometry + brand tokens (shared)
    ├── themes/
    │   ├── quarterly.html  + .css    ← layout 1 — data-forward quarterly
    │   ├── milestone.html  + .css    ← layout 2 — hero-photo single win
    │   └── celebration.html + .css   ← layout 3 — festive mosaic + wins
    ├── assets/
    │   ├── logo.png                  ← real NavSahyog wordmark
    │   ├── photo-placeholder.svg     ← fallback when /api/media/raw has no bytes
    │   └── photos/                   ← library of stock NavSahyog photos
    │       ├── hero-mission.jpg      ← running race, village grounds
    │       ├── impact-hero.jpg       ← Kho-Kho under the mango tree
    │       ├── story-1.jpg           ← reading circle
    │       ├── story-2.jpg           ← group portrait with coordinator
    │       └── story-longjump.jpg    ← long-jump mid-air
    └── examples/
        ├── belur-q1-2026.quarterly.json      (+ pdf + preview.png)
        ├── belur-kho-kho.milestone.json      (+ pdf + preview.png)
        └── belur-annual-2026.celebration.json (+ pdf + preview.png)
```

The renderer picks `themes/<theme>.html` based on the JSON's `theme`
field (or the `--theme` CLI flag), then writes `<stem>.pdf` and
`<stem>.preview.png` next to the input JSON.

## Themes are layouts, not just palettes

Each theme has its **own HTML template and its own data shape**.
Pick the theme first; the data you assemble depends on it.

### `quarterly` — data-forward recap

Header → 5-stat tile strip → title + 2-paragraph story + pullquote
→ highlights strip (3 kicker/body) → 3-photo grid → footer.

Required keys: `village`, `window`, `stats[]` (4–5), `story.{title,body,quote,attribution}`, `media[]` (3).
Optional: `highlights[]` (3), `donor.name`, `footer.*`.

Use for: a term / quarter / rolling-90-day update where you want
the numbers to carry. This is the default when the operator hasn't
said otherwise.

### `milestone` — one big win

Deep-green header band → **full-width hero photo with gold rail** →
badge + achievement title → pullquote → one-paragraph story → 3
supporting stats → footer.

Required keys: `village`, `window`, `hero.url`, `milestone.{badge,title,child,date}`, `story.body`, `stats[]` (3).
Optional: `story.{quote,attribution}`, `donor.name`, `footer.*`.

Use for: a district-level medal, a graduation, a streak milestone,
a first-ever. The photo does the work; keep copy short.

### `celebration` — festive multi-win

**Saffron hero band** with title + subtitle + window stamp →
**2×2 photo mosaic** with captions → "Wins of the Year" list (5+
dated entries) → closer quote → footer.

Required keys: `village`, `window`, `hero.{title,subtitle}`, `mosaic[]` (4), `wins[]` (5–8).
Optional: `closer.{quote,attribution}`, `donor.name`, `footer.*`.

Use for: annual recaps, festivals, cluster-level celebrations —
anywhere joy beats data.

## Usage

Requires Playwright with Chromium. On most machines the default
cache (`~/.cache/ms-playwright/` on Linux, `~/Library/Caches/…` on
macOS) is auto-discovered; just run:

```bash
node .claude/skills/donor-update/references/render.mjs \
  .claude/skills/donor-update/references/examples/belur-q1-2026.quarterly.json
```

If Playwright can't find Chromium (e.g. browsers were installed to
a custom path, or you're in a sandboxed environment like the
Claude Code web harness where they live at `/opt/pw-browsers`),
prepend `PLAYWRIGHT_BROWSERS_PATH=<path>`:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node .claude/skills/donor-update/references/render.mjs \
  .claude/skills/donor-update/references/examples/belur-q1-2026.quarterly.json
```

The theme is read from the JSON. Override on the command line only
if you *also* updated the data to match the new layout's shape:

```bash
node .claude/skills/donor-update/references/render.mjs \
  .claude/skills/donor-update/references/examples/belur-kho-kho.milestone.json \
  --theme=milestone
```

Keep the rendered HTML for debugging:

```bash
node .claude/skills/donor-update/references/render.mjs <data.json> --keep-html
# writes references/themes/.render.html
```

## How the skill uses this

`SKILL.md` (one level up) drives the content side:

1. Chooses the theme from the operator's intent (or defaults to
   `quarterly`).
2. Reads the matching example JSON to learn the shape.
3. Composes the data from the ERP read APIs (children, attendance,
   achievements, media — §5.6/5.9/5.10/5.8).
4. Downloads the required photos (`/api/media/raw/:uuid`) or falls
   back to a stock photo from `assets/photos/`.
5. Writes the JSON to `references/examples/<slug>.<theme>.json`.
6. Shells out to `references/render.mjs`.
7. Presents the preview PNG for operator review.
8. Iterates on content, photos, or layout choice as the operator
   asks.

## Production gaps to close

- **Real consented village photos.** The examples use
  NavSahyog-Website stock photos (`assets/photos/*.jpg`) because
  seeded `media` rows have no R2 objects behind them. A live run
  fetches bytes via `GET /api/media/raw/:uuid` and saves them
  alongside the JSON.
- **Consent filter.** See `review-findings-v1.md` U7. Until a
  `donor_shareable` flag lands on `media`, every selected item is
  assumed shareable — the same placeholder assumption the skill
  carries in its WhatsApp / email drafts.
- **Font embedding.** The templates name local system fonts. For
  consistent cross-device rendering (particularly Devanagari for
  `lang=hi`), embed a font family in `base.css` via `@font-face`
  before distributing.
