# KPI classification rules (dot grid)

The Home-page KPI tiles carry a 12-week × 7-day dot grid below the
big number. Each dot is one IST calendar day classified under a
per-KPI rule:

| Dot | Meaning |
|---|---|
| **Green** (`good`) | The day met the threshold — activity happened and it was good. |
| **Grey** (`empty`) | No signal for the day — no session held, no activity (or the rule says "don't count zero"). |
| **Red** (`bad`) | A session happened but the metric fell below the threshold. |

Layout: row 0 (top) = current week, row 11 (bottom) = 11 weeks
ago. Columns are Mon → Sun. Future days in the current week stay
grey so the grid is always rectangular.

## Why this lives server-side

The rules are a runtime tunable, not a code concern. Ops might
decide tomorrow that 60% attendance is the red line instead of
70%, or that two images a day is the new green bar. We should be
able to change that without shipping a web bundle.

Per the project convention (CLAUDE.md → "runtime tunables are
Worker env vars, no `app_settings` table"), the rules live in a
single JSON env var: **`KPI_RULES_JSON`**. It's set in
`apps/api/wrangler.toml` for dev and via `wrangler secret put
KPI_RULES_JSON --env <env>` for staging / production. Missing /
malformed JSON falls back to `DEFAULT_KPI_RULES` in
`packages/shared/src/insights.ts` so a bad deploy can't brick the
home page.

## Rule shape

```ts
type KpiRule = {
  metric: 'pct' | 'count' | 'inverse_count';
  good_gte?: number;
  bad_lt?: number;
  good_lte?: number;
  bad_gt?: number;
  empty_when: 'no_session' | 'zero' | 'never';
};
```

- `metric` picks which daily series the rule reads:
  - `pct` — weekly attendance %. Value = `(present / total) * 100`
    on days a session ran; `empty_when: 'no_session'` means days
    without a session render grey regardless.
  - `count` — daily count (images / videos / achievements).
  - `inverse_count` — lower is better (at-risk villages). Uses
    `good_lte` / `bad_gt` instead of `good_gte` / `bad_lt`.
- `empty_when` decides when a day renders grey:
  - `no_session` — day is grey unless an attendance session with
    marks happened that day (used for attendance + media KPIs,
    because "no session" ≠ "zero uploads").
  - `zero` — a day with value 0 is grey; anything positive is
    classified by the thresholds. Used for achievements, where
    absence isn't "bad".
  - `never` — never grey. Used for at-risk counts where 0 is the
    green target.

## Default rules (shipped)

| KPI label | Metric | Good | Bad | Empty when |
|---|---|---|---|---|
| `attendance_week` | pct | `>= 70` | `< 70` | No session that day |
| `images_month` | count | `>= 1` | `< 1` | No session that day |
| `videos_month` | count | `>= 1` | `< 1` | No session that day |
| `achievements_month` | count | `>= 1` | `< 1` | Value is 0 |
| `at_risk` | inverse_count | `<= 0` | `> 0` | Never |
| `children` | — | — | — | (census — no dot grid) |

### Reading the rules

- **Attendance** — a day is green if 70%+ of marked students were
  present that day, red if under 70%, grey if no session was held.
- **Images / Videos** — a day is green if at least one media
  item was captured in scope that day, red if a session ran but
  nothing was captured, grey if there was no session. The "ran a
  session but didn't document it" miss is what ops wants to see.
- **Achievements** — a day is green if anything was recorded
  (any type: SoM, gold, silver). Empty days are grey, never red —
  we don't want to guilt villages for days without an award.
- **At-risk** — the dot grid doesn't apply yet (see "Future
  work"); the tile still renders with a big number + no grid.

## Overriding in an environment

Set the env var directly in `wrangler.toml` for dev:

```toml
[vars]
KPI_RULES_JSON = """{
  "attendance_week": {"metric":"pct","good_gte":70,"bad_lt":70,"empty_when":"no_session"}
}"""
```

Or as a secret for staging / production:

```sh
wrangler secret put KPI_RULES_JSON --env staging
# paste the JSON at the prompt, then:
wrangler deploy --env staging
```

Only the labels you override need to appear — any label missing
from your JSON keeps its default. Setting a label to `null`
disables its dot grid entirely (the tile renders without dots).

## Future work

- **Per-day at-risk rollup.** The at-risk KPI carries `dots: null`
  because reconstructing per-day at-risk state needs a separate
  daily scan we haven't built. When we add it, the rule
  (`good_lte: 0`, `bad_gt: 0`) already works — the classifier
  just needs a daily series to read.
- **Per-scope overrides.** The current rules apply to every
  scope uniformly. If zone / cluster / village need different
  thresholds, the env var can carry a nested map — additive
  change, same classifier.
