# Regression corpus

Real-shaped payloads from each release of every offline-eligible
endpoint, replayed against the current server in CI. A failing
payload means the additive-only contract (decisions.md D30) was
violated — a field was renamed, removed, or had its validation
tightened, breaking deployed clients that have queued items in
the old shape.

The corpus is the load-bearing piece of the L4 platform: without
it, "additive-only" is a doc claim; with it, every PR proves the
claim against every release we've shipped.

## Layout

```
regression-corpus/
├── README.md          ← this file
└── <release>/
    └── <endpoint-slug>.json
```

Each release that ships a new offline-eligible endpoint shape
adds one file per endpoint under its release directory. Files
never move once committed — the whole point is that *old*
payloads keep replaying cleanly forever.

## File format

```jsonc
{
  "release": "L4.1",
  "endpoint": "POST /api/attendance/submit",
  "schema_version": 1,
  "payloads": [
    {
      "name": "minimal — one student marked present",
      "body": {
        "village_id": 1,
        "event_id": 1,
        "date": "2026-04-27",
        "start_time": "10:00",
        "end_time": "11:00",
        "marks": [{ "student_id": 1, "present": true }]
      }
    },
    {
      "name": "voice note attached",
      "body": { /* … */ }
    }
  ]
}
```

`name` is for human-readable failure output; `body` is the actual
request body sent on replay.

## Workflow

1. **Adding a new offline-eligible endpoint.** Land the endpoint
   itself first (server route, capability gate, decision in
   `decisions.md`). Then add a corpus file under
   `regression-corpus/<release>/<endpoint-slug>.json` covering
   at least one happy-path payload. Future releases that change
   the endpoint shape append more entries to that same file
   under a new release directory.
2. **Adding a nullable field to an existing endpoint.** No
   corpus change required — old payloads must keep working. CI
   verifies that.
3. **Removing or renaming a field, or tightening validation.**
   Forbidden under the additive-only contract. The failing CI
   payload is the test. If you genuinely need to break the
   contract, ship a new endpoint version (`/api/attendance/submit/v2`)
   and leave v1 accepting old payloads under an adapter.

## Authentication

The harness logs in as `vc-anandpur` (a write-tier VC seeded by
`db/seed.sql`) and reuses the cookie across replays. Payloads
that need a different role's scope can override the login user
via a `login_as` field on the file:

```jsonc
{
  "release": "L4.2",
  "endpoint": "POST /api/ponds",
  "login_as": "cluster-admin-anandpur",
  "payloads": [ /* … */ ]
}
```

## What counts as success

The harness expects each payload to return a 2xx response. A
non-2xx is a contract violation — it means a previously-valid
payload no longer satisfies the server's validation. CI reports
`<release>/<endpoint>` and the response status so the breaking
change is obvious in the failure summary.
