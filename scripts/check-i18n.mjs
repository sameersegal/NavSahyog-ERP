#!/usr/bin/env node
// Build-time i18n parity check.
//
// Reads every catalog under apps/web/src/locales and confirms it has
// exactly the same key set as English. Exits non-zero on any drift.
// Wired into CI so a missing Hindi (or future) string fails the
// build instead of silently falling back to English at runtime.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, '..', 'apps', 'web', 'src', 'locales');

const files = readdirSync(localesDir).filter((f) => f.endsWith('.json'));
const catalogs = Object.fromEntries(
  files.map((f) => [basename(f, '.json'), JSON.parse(readFileSync(join(localesDir, f), 'utf8'))]),
);

const en = catalogs.en;
if (!en) {
  console.error('check-i18n: en.json is missing');
  process.exit(1);
}
const enKeys = new Set(Object.keys(en));

let ok = true;
for (const [lang, catalog] of Object.entries(catalogs)) {
  if (lang === 'en') continue;
  const keys = new Set(Object.keys(catalog));
  const missing = [...enKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !enKeys.has(k));
  if (missing.length || extra.length) {
    ok = false;
    console.error(`check-i18n: ${lang}.json mismatch`);
    if (missing.length) console.error(`  missing: ${missing.join(', ')}`);
    if (extra.length) console.error(`  extra:   ${extra.join(', ')}`);
  }
}

if (!ok) process.exit(1);
console.log(`check-i18n: ${files.length} catalog(s) in sync (${enKeys.size} keys)`);
