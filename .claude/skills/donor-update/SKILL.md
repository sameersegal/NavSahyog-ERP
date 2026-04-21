---
name: donor-update
description: Draft a donor engagement update for a specific NavSahyog village and timeframe, by composing reads across the ERP APIs. Use when the operator asks for "donor update", "quarterly update for village X", "write a donor letter", "donor PDF", or similar. Outputs are (a) a markdown draft the operator reviews and sends manually via email or WhatsApp, and (b) a 1-pager PDF the operator can attach, rendered from mvp/donor-pdf/.
---

# Donor update

The operator maintains the donor ↔ village mapping outside the
system. They invoke this skill with a single village and a date
range; the skill fetches stats + media from the ERP and drafts an
engagement message the operator then reviews and sends.

## Inputs

Collect these from the operator before making any API call. If
something is missing, ask once — don't guess.

| Input | Required | Notes |
|---|---|---|
| `village` | yes | UUID, or a name the operator will resolve. Prefer UUID. |
| `from`, `to` | yes | ISO dates bounding the update window (e.g. calendar quarter, rolling 90 days — whatever the operator specifies). |
| `channel` | yes | `whatsapp` or `email`. Governs length and tone of the markdown draft. |
| `pdf` | no | `true` \| `false`. Default: `true`. When true, also render the 1-pager PDF from `mvp/donor-pdf/` (step 8). |
| `theme` | no | `quarterly` (default), `celebration`, or `milestone`. Maps to `mvp/donor-pdf/themes/<name>.css`. Free-text prompts ("festive", "formal", …) are mapped to the closest preset. |
| `tone` | no | Free-text hint (e.g. "warm", "formal", "data-heavy"). Default: warm-but-factual. |
| `donor_name` | no | If given, address the message to them. Otherwise produce a generic draft. |
| `length` | no | `short` (≤ 120 words, WhatsApp default), `medium` (≤ 300, email default), `long` (≤ 600). |
| `language` | no | `en` or `hi`. Default `en`. |

## Procedure

Run these reads **in parallel where possible**. All calls assume
the operator's session cookie; no separate auth step.

### 1. Resolve village (only if name was given)

`GET /api/geo/villages?q=<name>` — case-insensitive substring
match on village name, scope-filtered (§5.3). If the match set is
ambiguous (> 1 result), show the operator the candidates with
cluster/district context and ask which they meant.

### 2. Fetch stats (parallel)

- `GET /api/children?village=<uuid>&include_graduated=false`
  → active children count, gender split, program-join dates.
- `GET /api/attendance?village=<uuid>&from=<from>&to=<to>`
  → session rows + marks. Compute:
  - sessions held
  - average children per session
  - attendance %  = `sum(present) / sum(marks)`
  - best-attended session (date, event, count)
- `GET /api/achievements?village=<uuid>&from=<from>&to=<to>&type=SoM`
  → SoM count, child names, descriptions.
- `GET /api/achievements?village=<uuid>&from=<from>&to=<to>&type=Gold`
  → gold medal count (sum `gold_count`), descriptions.
- `GET /api/achievements?village=<uuid>&from=<from>&to=<to>&type=Silver`
  → silver medal count, descriptions.

### 3. Fetch media (parallel)

- `GET /api/media?village=<uuid>&kind=photo&from=<from>&to=<to>`
- `GET /api/media?village=<uuid>&kind=video&from=<from>&to=<to>`

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

Skip this step if the operator asked for markdown only.

1. Assemble the data JSON per `mvp/donor-pdf/README.md`. Populate:
   - `village`, `window`, `donor`, `theme`, `lang`
   - `stats[]` (4–5 tiles; typical picks: children active,
     sessions held, attendance %, SoMs, gold medals)
   - `story.title`, `story.body` (2 paragraphs, ~150–200 words),
     `story.quote`, `story.attribution`
   - `highlights[]` (three kicker/body pairs — Feb / Mar / Apr
     moments, or Event A / Event B / Event C)
   - `media[]` (exactly three items with `url` + `caption`).
     Download each selected media item via
     `GET /api/media/raw/:uuid` into a sibling `media/` folder
     and reference with a relative path; absolute `file://`
     URLs also work.
2. Write the JSON to `mvp/donor-pdf/examples/<village>-<window>.json`.
3. Invoke the renderer:
   ```
   node scripts/render-donor-pdf.mjs \
     mvp/donor-pdf/examples/<slug>.json \
     [--theme=<name>]
   ```
   The renderer writes `<slug>.pdf` and `<slug>.preview.png`
   next to the JSON.
4. Show the operator the preview PNG and the path to the PDF.

### 9. Iterate

The operator will often want one or more rounds of changes:

- **"Use celebration theme"** → re-run step 8 with `--theme=celebration`.
- **"Swap media 2 for item 5"** → edit `media[1]` in the JSON,
  re-run step 8.
- **"Make the story warmer"** / **"Tighten the second paragraph"** →
  regenerate `story.body` only, re-run step 8.
- **"Add an `Activity of the Quarter` highlight"** → adjust
  `highlights[]` (3 items max — more overflows the strip).

Regenerate from the existing JSON; don't re-fetch the API data
unless the window or village changes. Each render is fast (~2 s).

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

Operator: "Draft a donor update for village `v_abc123`, Q1 2026,
email, warm tone, for Mrs. Sharma."

Skill resolves:
- `from=2026-01-01`, `to=2026-03-31`
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
