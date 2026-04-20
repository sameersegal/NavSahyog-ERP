import { env, SELF } from 'cloudflare:test';
// `?raw` inlines the file as a string at test-bundle time. We can't
// readFileSync at runtime because the worker runtime doesn't expose
// the host filesystem.
//
// import.meta.glob returns every migration file sorted by name so new
// migrations (0002_*.sql, 0003_*.sql, …) slot in without touching
// this file. Production schema is applied by `wrangler d1 migrations
// apply` against the same folder.
const migrationModules = import.meta.glob<string>(
  '../../../db/migrations/*.sql',
  { query: '?raw', import: 'default', eager: true },
);
const migrations: string[] = Object.keys(migrationModules)
  .sort()
  .map((path) => migrationModules[path] as unknown as string);
import seedSql from '../../../db/seed.sql?raw';

// D1.exec() expects one statement per line; our SQL is formatted
// for readability. Strip comments, split on `;`, run each through
// prepare().run() one by one.
function statementsFrom(raw: string): string[] {
  const noLineComments = raw.replace(/^\s*--.*$/gm, '');
  return noLineComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function applySchema(db: D1Database): Promise<void> {
  for (const migration of migrations) {
    for (const stmt of statementsFrom(migration)) {
      await db.prepare(stmt).run();
    }
  }
}

export async function applySeed(db: D1Database): Promise<void> {
  // seed.sql leads with DELETE FROM on every table, so running it
  // repeatedly is idempotent — no schema re-apply needed.
  for (const stmt of statementsFrom(seedSql)) {
    await db.prepare(stmt).run();
  }
}

export async function applySchemaAndSeed(db: D1Database): Promise<void> {
  await applySchema(db);
  await applySeed(db);
}

export async function resetDb(): Promise<void> {
  await applySeed(env.DB);
}

export async function loginAs(
  userId: string,
  password = 'password',
): Promise<string> {
  const res = await SELF.fetch('http://api.test/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: userId, password }),
  });
  if (!res.ok) throw new Error(`login ${userId} failed: ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('no cookie on login');
  const match = /nsf_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error('no session cookie');
  return match[1]!;
}
