# Donor update — 1-pager PDF

A single-page A4 infographic the operator can attach to a WhatsApp
message or email for a donor. Built from a JSON data file + an HTML
template; rendered to PDF + PNG preview via Playwright.

## Files

```
mvp/donor-pdf/
├── template.html                 ← Mustache-style slots
├── styles.css                    ← layout + typography (theme-agnostic)
├── themes/
│   ├── quarterly.css             ← default — NavSahyog teal-green
│   ├── celebration.css           ← warm saffron; festivals, AC wins
│   └── milestone.css             ← formal deep-green + gold; single win
├── assets/
│   ├── logo.svg                  ← placeholder — swap before production
│   └── photo-placeholder.svg     ← stands in when real media bytes absent
└── examples/
    └── belur-q1-2026.json        ← real-data sample
```

The renderer lives at `scripts/render-donor-pdf.mjs`. It takes a
data JSON, expands the template, and writes `<stem>.pdf` +
`<stem>.preview.png` next to the input.

## Data shape

See `examples/belur-q1-2026.json` for a working example. Minimum
required keys:

- `village.name`, `village.cluster`
- `window.label`, `window.from`, `window.to`
- `stats[]` — four to five tiles (any more overflows the strip)
- `story.title`, `story.body` (supports `\n\n` paragraph breaks)
- `media[]` — exactly three items; each needs `url` + `caption`.
  Relative URLs resolve against the JSON file's directory; absolute
  `file://`/`http(s)://` URLs pass through.

Optional:

- `story.quote`, `story.attribution`
- `highlights[]` — three mini cards (kicker + body); shown only if
  present
- `donor.name` — if set, the footer shows "Made for ...".
- `theme` — `quarterly` (default), `celebration`, `milestone`
- `footer.tagline`, `footer.org_url`, `footer.contact` — all
  defaulted

## Usage

Requires Playwright with Chromium. If Chromium is pre-installed
elsewhere, point Playwright at it with the `PLAYWRIGHT_BROWSERS_PATH`
env var:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node scripts/render-donor-pdf.mjs mvp/donor-pdf/examples/belur-q1-2026.json
```

Override the theme without editing the JSON:

```bash
node scripts/render-donor-pdf.mjs \
  mvp/donor-pdf/examples/belur-q1-2026.json \
  --theme=celebration
# writes belur-q1-2026.celebration.pdf + .celebration.preview.png
```

Keep the rendered HTML for debugging:

```bash
node scripts/render-donor-pdf.mjs <data.json> --keep-html
```

## How the skill uses this

`.claude/skills/donor-update/SKILL.md` drives the content side:

1. Composes the data JSON from the ERP read APIs (children,
   attendance, achievements, media — §5.6/5.9/5.10/5.8).
2. Drafts `story.title`, `story.body`, `story.quote`, and the
   optional `highlights[]` from stats + achievement descriptions.
3. Writes the JSON to `mvp/donor-pdf/examples/<slug>.json`.
4. Shells out to this renderer.
5. Presents the preview PNG for operator review.
6. The operator iterates — "try a celebration theme", "swap media 2
   for item 5", "tighten the second paragraph" — and the skill
   regenerates.

## Production gaps to close

- **Logo.** `assets/logo.svg` is an "N" placeholder. Replace with
  the official NavSahyog mark before any external distribution.
- **Real media bytes.** The example uses `photo-placeholder.svg`
  because seeded `media` rows have no R2 objects behind them. Real
  runs fetch bytes via `GET /api/media/raw/:uuid` (session-gated)
  and write them to a temp dir, then reference local paths.
- **Consent filter.** See `review-findings-v1.md` U7. Until a
  `donor_shareable` flag lands on `media`, every selected item is
  assumed shareable — the same placeholder assumption the skill
  carries in its WhatsApp / email drafts.
- **Font embedding.** The template names local system fonts. For
  consistent cross-device rendering (particularly Devanagari for
  `lang=hi`), embed a font family in `styles.css` via
  `@font-face` before distributing.
