#!/usr/bin/env node
// Capture script for the L3.1 Master Creations IA restructure —
// /masters card-grid index, drill-down sub-pages, and back-link.
//
// Prereqs:
//   pnpm --filter @navsahyog/api db:reset
//   pnpm --filter @navsahyog/web build
//   pnpm --filter @navsahyog/api dev &      # 8787, serves dist + /api
//
// Then:
//   node scripts/capture-masters-ia.mjs

import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/masters-ia');
const BASE = 'http://localhost:8787';

const DESKTOP = { width: 1280, height: 800 };

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

async function shot(page, path, opts = {}) {
  await page.waitForTimeout(300);
  await page.screenshot({ path, fullPage: false, ...opts });
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

async function captureDesktop(browser) {
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await loginAs(page, 'super');

  // Index page — card grid with count badges per master.
  await page.goto(BASE + '/masters');
  await page.waitForSelector('h1');
  await page.waitForLoadState('networkidle');
  await shot(page, `${OUT}/01-index-desktop.png`);

  // Drill into Villages — back-link + form-toolbar + table.
  await page.goto(BASE + '/masters/villages');
  await page.waitForSelector('h1');
  await page.waitForLoadState('networkidle');
  await shot(page, `${OUT}/02-villages-desktop.png`);

  // Open the create form to show what a sub-page looks like with
  // the inline form expanded.
  await page.click('button:has-text("Add village")');
  await shot(page, `${OUT}/03-villages-form-desktop.png`);

  await context.close();
}

async function captureMobile(browser) {
  const context = await browser.newContext({
    ...devices['Pixel 5'],
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await loginAs(page, 'super');

  // Index page on mobile — single column.
  await page.goto(BASE + '/masters');
  await page.waitForSelector('h1');
  await page.waitForLoadState('networkidle');
  await shot(page, `${OUT}/04-index-mobile.png`);

  // Drill into Users — picks up the most multi-field form.
  await page.goto(BASE + '/masters/users');
  await page.waitForSelector('h1');
  await page.waitForLoadState('networkidle');
  await shot(page, `${OUT}/05-users-mobile.png`);

  await context.close();
}

async function main() {
  await ensure(OUT);
  const browser = await chromium.launch();
  await captureDesktop(browser);
  await captureMobile(browser);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
