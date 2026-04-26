#!/usr/bin/env node
// L3.1 Master Creations screenshot harness. Drives a headless
// chromium against the local dev stack and captures one image per
// tab + the create-form open state for the PR body.
//
// Prereqs:
//   pnpm db:reset
//   pnpm --filter @navsahyog/web build      # wrangler [assets] needs dist
//   pnpm --filter @navsahyog/api dev &      # 8787, serves dist + /api
//
// Then:
//   node scripts/capture-l3.1.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l3.1');
const BASE = 'http://localhost:8787';

const DESKTOP = { width: 1280, height: 800 };

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

async function shot(page, path) {
  await page.waitForTimeout(300);
  await page.screenshot({ path, fullPage: false });
  console.log('  →', path.replace(ROOT + '/', ''));
}

async function loginAs(page, userId, password = 'password') {
  await page.goto(BASE + '/login');
  await page.waitForSelector('input[autocomplete="username"]');
  await page.fill('input[autocomplete="username"]', userId);
  await page.fill('input[autocomplete="current-password"]', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login')),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle');
}

async function main() {
  await ensure(OUT);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const page = await context.newPage();

  await loginAs(page, 'super');
  await page.goto(BASE + '/masters');
  await page.waitForSelector('h2');

  // Each tab — list view.
  for (const tab of ['villages', 'schools', 'events', 'qualifications', 'users']) {
    await page.click(`button[role="tab"]:has-text("${tabLabel(tab)}")`);
    await page.waitForLoadState('networkidle');
    await shot(page, `${OUT}/01-tab-${tab}.png`);
  }

  // Form open — village create.
  await page.click('button[role="tab"]:has-text("Villages")');
  await page.waitForLoadState('networkidle');
  await page.click('button:has-text("Add village")');
  await shot(page, `${OUT}/02-form-village-create.png`);
  await page.click('button:has-text("Cancel")');

  // Event row with kind_locked — open the edit form on the seeded
  // "Board Games" activity (event_id=3 has 196 attendance refs).
  await page.click('button[role="tab"]:has-text("Events")');
  await page.waitForLoadState('networkidle');
  await page.click('tr:has-text("Board Games") button:has-text("Edit")');
  await shot(page, `${OUT}/03-form-event-kind-locked.png`);
  await page.click('button:has-text("Cancel")');

  // Users tab — open create form so the role-driven scope picker
  // is visible.
  await page.click('button[role="tab"]:has-text("Users")');
  await page.waitForLoadState('networkidle');
  await page.click('button:has-text("Add user")');
  await shot(page, `${OUT}/04-form-user-create.png`);

  await browser.close();
}

function tabLabel(tab) {
  return {
    villages: 'Villages',
    schools: 'Schools',
    events: 'Events',
    qualifications: 'Qualifications',
    users: 'Users',
  }[tab];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
