---
name: donor-update
description: Draft a donor engagement update for a specific NavSahyog village and timeframe, by composing reads across the ERP APIs. Use when the operator asks for "donor update", "quarterly update for village X", "write a donor letter", "donor PDF", or similar. Outputs are (a) a markdown draft the operator reviews and sends manually via email or WhatsApp, and (b) a 1-pager PDF the operator can attach, rendered from this skill's `references/` templates.
---

# Donor update

The operator maintains the donor ↔ village mapping outside the
system. They invoke this skill with a single village and a date
range; the skill fetches stats + media from the ERP and drafts an
engagement message the operator then reviews and sends.

## Files in this skill

Everything lives under this skill's own directory — `skills/donor-update/`
in the repo, `~/.claude/plugins/cache/navsahyog/navsahyog-erp/skills/donor-update/`
when installed via `/plugin install`. Paths below are relative to
that directory; `$SKILL_DIR` in the shell snippets stands for whichever
of those two it actually is.

| File | Role | What the agent does with it |
|---|---|---|
| `SKILL.md` | this document | follow the Procedure below |
| `references/render.mjs` | **execute** — HTML→PDF+PNG via Playwright | `node …/render.mjs <data.json>`; do not edit |
| `references/base.css` | shared page geometry + NavSahyog brand tokens | edit only when re-theming the whole brand |
| `references/themes/quarterly.html` + `quarterly.css` | **layout 1** — 5-stat strip + story + 3-photo grid; data-forward | read the matching example before writing JSON; edit CSS only for structural tweaks |
| `references/themes/milestone.html` + `milestone.css` | **layout 2** — dominant hero photo + single achievement headline; formal | same |
| `references/themes/celebration.html` + `celebration.css` | **layout 3** — saffron hero band + 2×2 photo mosaic + wins list; festive | same |
| `references/assets/logo.png` | real NavSahyog wordmark | leave as-is; every theme consumes it |
| `references/assets/photo-placeholder.svg` | fallback when no real bytes | used only when `/api/media/raw/:uuid` has no object behind it |
| `references/examples/belur-q1-2026.quarterly.json` | **canonical quarterly shape** | read first if `theme=quarterly` |
| `references/examples/belur-kho-kho.milestone.json` | **canonical milestone shape** | read first if `theme=milestone` |
| `references/examples/belur-annual-2026.celebration.json` | **canonical celebration shape** | read first if `theme=celebration` |
| `references/examples/*.preview.png` | rendered reference previews | compare your output to the matching one before reporting done |
| `references/README.md` | longer human-facing notes | skim if a step is unclear |

If the operator mentions a file under `references/` directly
("tweak the celebration palette", "make the milestone hero taller"),
edit it in place and re-render; don't clone it outside the skill.

## Choosing a theme

Each theme is a **different layout**, not just a different palette.
Pick first, then write the JSON for that shape.

| Theme | Layout feel | When to use |
|---|---|---|
| `quarterly` | header · 5-stat strip · story · highlights strip · 3-photo grid · footer | routine period update (a quarter, a term, rolling 90 days). Data-forward. **Default when in doubt.** |
| `milestone` | green header band · **big hero photo** · achievement headline · pullquote · short story · 3 supporting stats · footer | one standout event: a district medal, a graduation, a streak milestone, a first-ever. The photo does the work. |
| `celebration` | **warm saffron hero band** · 2×2 photo mosaic · wins list (5+ dated entries) · closer quote · footer | annual recap, festival, cluster-level celebration. Joy over data; 4+ photos, 5+ discrete wins. |

Map operator phrasing:
- "quarterly update" / "this term" / "last 90 days" → `quarterly`
- "celebrate this win" / "district gold" / "one-pager about X" → `milestone`
- "annual report" / "year-in-review" / "wrap-up" → `celebration`

## Setup — pointing the skill at a backend

Authentication is a one-time browser handshake driven by the
`scripts/nsf-auth.mjs` helper (D36 layer-1 → layer-2 bridge over
loopback). The helper opens a tab in the operator's default
browser, runs Clerk's hosted sign-in widget, captures the
resulting Clerk JWT on a localhost callback, swaps it for an
`nsf_session` cookie via `/auth/exchange`, and persists the cookie
to `~/.nsf/credentials` (mode 0600). The cookie is good for 30
days sliding (D36); the helper only needs to run again when the
operator signs out, the cookie expires, or Clerk's webhook
revokes the local session row.

| Backend | Helper invocation |
|---|---|
| Local dev (`pnpm dev`) | `node scripts/nsf-auth.mjs` |
| Staging | `node scripts/nsf-auth.mjs --web=https://<web> --api=https://navsahyog-api-staging.sameersegal.workers.dev --basic-auth=<user>:<pass>` |

Defaults are `web=http://localhost:5173` and
`api=http://127.0.0.1:8787`. The `--basic-auth` flag is only
needed for staging (the Worker's `STAGING_BASIC_AUTH_*` outer
gate is in front of `/auth/exchange`). Both flags also accept
`NSF_WEB_BASE_URL` / `NSF_API_BASE_URL` / `NSF_BASIC` env vars.

### Per-session bootstrap

Every skill run starts with one line that loads the env vars from
the persisted credentials:

```bash
eval "$(node scripts/nsf-auth.mjs --env)"
```

This sets `NSF_API_BASE_URL`, `NSF_COOKIE_JAR` (a Netscape-format
file that curl reads with `-b`), and — when applicable —
`NSF_BASIC`. If credentials are missing or expired the helper
exits non-zero with a one-line hint pointing at the sign-in
command above; surface that to the operator and stop.

Every subsequent call follows this template:

```bash
curl -sS -b "$NSF_COOKIE_JAR" ${NSF_BASIC:+-u "$NSF_BASIC"} \
  "$NSF_API_BASE_URL/api/<path>"
```

The `${NSF_BASIC:+...}` form expands to nothing when basic-auth
is unset (local dev), so the same template works in both
environments.

A `401` mid-session means the cookie expired or was revoked —
re-run `node scripts/nsf-auth.mjs` and tell the operator to
re-authenticate. A `403 user_not_provisioned` from `/auth/exchange`
means the operator has a Clerk account but no matching local
`user` row; an admin must create the local user first. A `403`
on a specific resource means the village is outside the
operator's scope — stop and tell the operator.

## Inputs

Collect these from the operator before making any API call. If
something is missing, ask once — don't guess.

| Input | Required | Notes |
|---|---|---|
| `village` | yes | Numeric id (D1 row id), or a name the agent resolves via step 1. The spec calls these "uuids" but the wire shape is `id: number`. |
| `from`, `to` | yes | ISO dates bounding the update window (e.g. calendar quarter, rolling 90 days — whatever the operator specifies). |
| `channel` | yes | `whatsapp` or `email`. Governs length and tone of the markdown draft. |
| `pdf` | no | `true` \| `false`. Default: `true`. When true, also render the 1-pager PDF from `references/` (step 8). |
| `theme` | no | `quarterly` (default), `milestone`, or `celebration`. **Picks both the layout and the visual style** — each theme has a different HTML template and a different data shape. See "Choosing a theme" above. Free-text prompts ("festive", "formal") are mapped to the closest preset. |
| `tone` | no | Free-text hint (e.g. "warm", "formal", "data-heavy"). Default: warm-but-factual. |
| `donor_name` | no | If given, address the message to them. Otherwise produce a generic draft. |
| `length` | no | `short` (≤ 120 words, WhatsApp default), `medium` (≤ 300, email default), `long` (≤ 600). |
| `language` | no | `en` or `hi`. Default `en`. |

## Procedure

Run these reads **in parallel where possible**. Every `curl`
follows the auth template from "Setup" above (`-b "$NSF_COOKIE_JAR"
${NSF_BASIC:+-u "$NSF_BASIC"}`). All paths are relative to
`$NSF_API_BASE_URL`.

The schema speaks **integer ids** end-to-end (D1 / SQLite); the
spec calls them "uuid" but the wire shape is `id: number`. Pass
whatever the operator gave you as-is — geo search returns numeric
ids and the rest of the pipeline takes them.

### 1. Resolve village (only if name was given)

`GET /api/geo/search?q=<name>&limit=20` — typeahead across
villages + clusters, scope-filtered (§5.3). The response is
`{ results: [{ level, id, name, path }, …] }`. **Filter to
`level === "village"`** (clusters share the namespace). If more
than one village matches, show the operator the candidates with
their `path` (parent cluster) for disambiguation and ask which
they meant.

### 2. Fetch stats (parallel)

- `GET /api/children?village_id=<id>&include_graduated=0`
  → active children count, gender split, program-join dates.
- `GET /api/dashboard/drilldown?metric=attendance&level=village&id=<id>&from=<from>&to=<to>&consolidated=1`
  → window-aggregate attendance + the §3.6.2 KPI strip
  (attendance %, avg children/session, image %, video %, SoM
  current/prev). Use the `consolidated.kpis` block directly;
  fall back to row-level computation only if the operator wants
  a metric that's not in the strip.
  - For best-attended session detail, follow up with
    `GET /api/attendance?village_id=<id>&date=<YYYY-MM-DD>` per
    candidate date — `/api/attendance` is a **per-day** endpoint
    (§5.6); it does not accept `from`/`to`.
- `GET /api/achievements?village_id=<id>&from=<from>&to=<to>&type=SoM`
  → SoM count, child names, descriptions.
- `GET /api/achievements?village_id=<id>&from=<from>&to=<to>&type=Gold`
  → gold medal count (sum `gold_count`), descriptions.
- `GET /api/achievements?village_id=<id>&from=<from>&to=<to>&type=Silver`
  → silver medal count, descriptions.

### 3. Fetch media (parallel)

- `GET /api/media?village_id=<id>&kind=image&from=<epoch>&to=<epoch>`
- `GET /api/media?village_id=<id>&kind=video&from=<epoch>&to=<epoch>`

`from`/`to` here are **Unix epoch seconds**, not ISO dates —
the column is `media.captured_at`. Convert the operator's
`from`/`to` window once: `date -u -d "<YYYY-MM-DD>" +%s`.

`kind` accepts `image | video | audio`; the legacy "photo"
spelling is rejected as a 400.

Each item returns a short-TTL presigned GET URL (§5.8, ≤ 15 min).
**Tell the operator the URLs expire quickly** — they should save
the media before composing the final message.

### 4. Select highlights

Pick **3–5 media items total**, favouring:
1. Items tagged to a notable `event` (Annual Competition, Special
   Event) over routine activities.
2. Items from dates overlapping SoM / medal wins — context links.
3. Temporal spread across the window — not all from one week.
4. Mix of photo and video when both exist.

If the operator asked for more/less, honour that.

### 5. Pull quotable snippets

Achievement descriptions (max 500 chars, §3.5) are the only
free-text narrative surface in the current schema. Pick at most
**one** short quote-worthy sentence and attribute it to the
achievement type + date ("From our Star of the Month, March
2026: …"). Do not invent attributions or quotes.

### 6. Draft

Output a single markdown block with this structure. Adjust length
per `length` input.

```
Subject: <village name> — <window label, e.g. "Q1 2026 update">
         (omit for WhatsApp)

<salutation — "Dear <donor_name>," or "Dear friend,">

<1–2 sentence opener naming the village and the window>

**By the numbers**
- <children active> children currently in the programme
- <sessions> sessions held across the <window>
- <attendance %>% average attendance
- <SoM count> Star of the Month recognitions
- <gold>G / <silver>S medals earned

**Moments from the ground**
<one quote-worthy snippet, if any>

<3–5 media items as a markdown list with presigned URLs,
each on its own line with a brief factual caption — date,
event/activity name. No fabricated descriptions.>

<1-sentence close>

<signoff>
```

For **WhatsApp**: collapse into a single short message, drop the
subject, drop the bold markdown (WhatsApp uses `*asterisks*`),
cap at ~120 words, and attach media URLs at the end labelled
`1.` `2.` `3.` so the operator can download and re-attach.

### 7. Surface what you used

After the draft, print a short block:

```
Sources used:
- children (N rows, as of <today>)
- attendance (<sessions> sessions, <from>–<to>)
- achievements (<N> rows, SoM/Gold/Silver)
- media (<N> photos, <N> videos; URLs expire <ts>)
```

So the operator can sanity-check coverage.

### 8. Render the 1-pager PDF (if `pdf=true`)

Skip this step if the operator asked for markdown only. All paths
in this step are relative to the repo root.

**Pick the theme first** (see "Choosing a theme" above). Then
**read the matching example JSON** — it's the canonical shape for
that layout:

- `theme=quarterly`   → `references/examples/belur-q1-2026.quarterly.json`
- `theme=milestone`   → `references/examples/belur-kho-kho.milestone.json`
- `theme=celebration` → `references/examples/belur-annual-2026.celebration.json`

Copy its structure verbatim (same keys, same ordering, same optional
fields); change only the values. **Data shapes differ per theme** —
don't assemble a `quarterly`-shaped JSON for a `milestone` render.

1. **Pick a slug** like `<village>-<window-or-event>.<theme>`, e.g.
   `belur-q1-2026.quarterly`, `belur-kho-kho.milestone`.

2. **Prepare photos.** Count depends on the theme:

   | Theme | Photo count | Where they go in the JSON |
   |---|---|---|
   | quarterly | 3 | `media[]` |
   | milestone | 1 (hero) | `hero.url` |
   | celebration | 4 | `mosaic[]` |

   Download from the live API (reuses the env vars loaded by
   `eval "$(node scripts/nsf-auth.mjs --env)"`):
   ```
   mkdir -p "$SKILL_DIR/references/examples/<slug>/media"
   for u in <uuid1> <uuid2> <uuid3>; do
     curl -sS -b "$NSF_COOKIE_JAR" ${NSF_BASIC:+-u "$NSF_BASIC"} \
       "$NSF_API_BASE_URL/api/media/raw/$u" \
       -o "$SKILL_DIR/references/examples/<slug>/media/$u"
   done
   ```
   If a fetched file is < 1 KiB it's probably a JSON error (or an
   HTML basic-auth challenge from the staging gate), not an image.
   The skill doesn't ship stock photos — if the village genuinely
   has no consented media yet, set that slot to
   `../assets/photo-placeholder.svg` and flag the gap in the
   sources block so the operator knows not to send the draft
   externally until real photos land.

3. **Assemble the data JSON.** Keys vary by theme (consult the
   matching example). Rules common to all three:
   - `theme` — the preset name exactly (`quarterly`, `milestone`,
     or `celebration`).
   - Relative image URLs resolve against the JSON file's directory;
     absolute `file://` / `http(s)://` URLs pass through.
   - `donor.name` surfaces "Made for <name>" in the footer; omit
     for a generic render.
   - `footer.tagline` / `footer.org_url` / `footer.contact` are
     defaulted when absent.

   Per-theme extras:
   - **quarterly** — `stats[]` 4–5 tiles, `story.body` 2 paragraphs
     (~150–200 words, `\n\n` between), `story.quote` + attribution,
     `highlights[]` exactly 3 kicker/body pairs, `media[]` exactly 3.
   - **milestone** — `hero.url`, `milestone.{badge,title,child,date}`,
     optional `story.quote` + attribution, `story.body` one paragraph
     (~100 words), `stats[]` exactly 3.
   - **celebration** — `hero.{title,subtitle}`, `mosaic[]` exactly 4
     with captions, `wins[]` 5–8 dated lines, optional
     `closer.{quote,attribution}`.

4. **Write the JSON** to
   `$SKILL_DIR/references/examples/<slug>.json`.

5. **Invoke the renderer.** On most machines Playwright auto-finds
   its Chromium in `~/.cache/ms-playwright/` — just run:
   ```
   node "$SKILL_DIR/references/render.mjs" \
     "$SKILL_DIR/references/examples/<slug>.json" \
     [--theme=<name>]
   ```
   Only if Playwright can't find Chromium (e.g. a sandboxed
   environment where browsers live in a non-default path), prepend
   `PLAYWRIGHT_BROWSERS_PATH=<path>`; in the Claude Code web
   harness that path is `/opt/pw-browsers`.

   The renderer picks `references/themes/<theme>.html` based on the
   JSON's `theme` (or `--theme`) and writes `<slug>.pdf` +
   `<slug>.preview.png` next to the JSON. Add `--keep-html` if a
   render looks wrong — it leaves `references/themes/.render.html`
   for inspection.

6. **Show the operator** the preview PNG (via the Read tool so the
   image actually renders in the session) and the paths to both
   files. Compare to the matching reference preview
   (`references/examples/<slug-of-same-theme>.preview.png`) — your
   render should hold the same rhythm.

### 9. Iterate

The operator will often want one or more rounds of changes. Don't
re-fetch API data unless the window or village changes — each
iteration is a JSON edit + a render (~2 s).

| Operator says | Agent does |
|---|---|
| "Try the celebration layout instead" / "switch to milestone" | **Regenerate the JSON for the new shape** — the data differs per theme. Re-read the matching example, re-shape the existing content (e.g. collapse `stats[]`+`highlights[]`+`media[]` into `wins[]`+`mosaic[]` for celebration), save as a new file with the matching slug, re-render. |
| "Use a warmer palette in the quarterly" | Edit `references/themes/quarterly.css` directly; don't change the layout. Re-render — the existing JSON is fine. |
| "Swap photo 2 for item 5" | Edit the photo slot in the JSON (download the new item into `<slug>/media/` if needed), re-run the renderer (step 8 sub-step 5). For milestone that's `hero.url`; for quarterly `media[1].url`; for celebration `mosaic[1].url`. |
| "Make the story warmer" / "Tighten paragraph 2" | Rewrite `story.body` only, re-run the renderer (step 8 sub-step 5). |
| "Add another win" (celebration) | Append to `wins[]` — up to ~8 before the list overflows. Re-render. |
| "Add an Activity of the Quarter highlight" (quarterly) | Update `highlights[]` (3 items max — more overflows the strip), re-render. |
| "Try a new theme called <X>" | Author `references/themes/<X>.html` + `references/themes/<X>.css` using the closest existing theme as template. Also create a matching example JSON. Then `theme: "<X>"`. |
| "Logo is wrong" | Replace `references/assets/logo.png` with the provided file; every theme consumes it automatically. |

## Output rules

- **No child PII in the draft.** No last names, no DOB, no school
  names, no parent names, no Aadhaar (obviously — child Aadhaar
  doesn't exist in the schema per §9.1). First names may be used
  only if attached to a public achievement (SoM winners,
  medallists) and never in combination with DOB or parent info.
- **No fabrication.** Every stat must trace to an API response.
  Every media URL must be one the API returned. If a category
  has zero results (e.g. no SoMs this quarter), say so — don't
  invent.
- **If attendance data is thin** (< 3 sessions in window), lead
  with media + achievements and downplay the numbers.
- **Language:** if `language=hi`, produce the draft in Hindi
  (Devanagari), keeping proper nouns and numerals unchanged.

## Assumptions (to revisit)

1. **All media is donor-shareable.** Treat every item returned by
   `/api/media` as cleared for external use. This is a stand-in
   until §9 adds explicit donor-consent flags. When those land,
   this skill must filter on that flag before including any item.
2. **Donor ↔ village mapping lives outside the system.** The
   operator passes one village per invocation. Multi-village
   donors get multiple invocations, stitched manually.
3. **Narrative surface is shallow.** Only achievement descriptions
   are free-text; voice notes on attendance sessions exist (§3.3)
   but are untranscribed audio. When richer story fields land,
   update step 5.

## Example invocation

Operator: "Draft a donor update for Belur (village id 2),
Q1 2026, email, warm tone, for Mrs. Sharma."

Skill resolves:
- `village_id=2`, `from=2026-01-01`, `to=2026-03-31`
- `channel=email`, `length=medium`
- `tone=warm`, `donor_name=Mrs. Sharma`

Then runs steps 2–7 and emits the markdown draft + sources block,
and (because `pdf` defaults true) runs step 8 to produce the PDF
+ preview. On "try a celebration theme", jumps to step 9 and
re-renders only.

## Spec cross-refs

- **§3.9** — the workflow this skill implements (functional
  requirements, scope, PII, consent, acceptance criteria).
- **§2.3** — the `donor_update` capability. Today: Super Admin
  only.
- **§5.3 / 5.6 / 5.8 / 5.9 / 5.10** — the endpoints composed
  above.
- **§9.4** — each invocation writes an `audit_log` entry of
  action `donor_update.draft`.
- **`review-findings-v1.md` U7** — the consent-flag gap this
  skill's "all media shareable" assumption stands in for.

A 403 on any underlying API call means the village is outside
the operator's scope — stop and tell the operator.
