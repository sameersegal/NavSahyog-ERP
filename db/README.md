# db/

Database artefacts. The target is Cloudflare D1 (SQLite-flavoured).

## Layout

- `migrations/` — numbered SQL migrations. **This is the source of
  truth for the schema.** `0001_init.sql` is the baseline; every
  subsequent structural change lands as `0002_<slug>.sql`,
  `0003_<slug>.sql`, etc.
- `seed.sql` — idempotent seed for the local lab DB. Leads with
  `DELETE FROM` on every seeded table so re-running it is safe.
  Not applied in production (dummy data only; see `mvp/level-1.md`).

## Local workflow

From `apps/api/`:

```
pnpm db:reset          # drop local D1 state, apply all migrations, seed
pnpm db:migrate        # apply pending migrations only
pnpm db:migrate:new <slug>   # scaffold the next numbered migration
pnpm db:seed           # re-run the seed (idempotent)
```

`db:reset` is safe for the lab because only dummy data lives
there. When we move to production, retire it.

## Rules

- **Never edit a migration after it has been applied to any D1 you
  care about.** Write a new one.
- **Migrations are forward-only.** A buggy migration is fixed by
  adding a corrective migration on top, not by rewriting history.
- **One logical change per migration.** Small migrations are easy
  to review and easy to roll back-by-compensation.
- **Migration filenames are `<4-digit-seq>_<snake_slug>.sql`.** The
  digit prefix is what `wrangler d1 migrations apply` uses to
  order them. `db:migrate:new` handles the numbering.

## Tests

`apps/api/test/setup.ts` loads every file in `migrations/` via
`import.meta.glob` in sort order — adding a new migration file is
zero test-harness work.
