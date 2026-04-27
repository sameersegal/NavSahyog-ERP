#!/usr/bin/env node
// L3.1.1 Training Manuals screenshot harness — captures the
// VC-mobile read-only catalogue and the Super-Admin Masters
// tab + create form for the PR body.
//
// Prereqs (same as capture-l3.1.mjs):
//   pnpm --filter @navsahyog/api db:reset
//   pnpm --filter @navsahyog/web build
//   pnpm --filter @navsahyog/api dev &      # 8787, serves dist + /api
//   (then seed a handful of /api/training-manuals rows so the page
//   has something to render — see the seed loop in the PR body.)
//
// Then:
//   node scripts/capture-l3.1.1.mjs

import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l3.1.1');
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

async function captureVcMobile(browser) {
  const context = await browser.newContext({
    ...devices['Pixel 5'],
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await loginAs(page, 'vc-anandpur');
  await page.goto(BASE + '/training-manuals');
  await page.waitForSelector('h2');
  await page.waitForLoadState('networkidle');
  await shot(page, `${OUT}/01-vc-mobile-catalogue.png`);
  await context.close();
}

async function captureSuperMastersDesktop(browser) {
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await loginAs(page, 'super');
  await page.goto(BASE + '/masters');
  await page.waitForSelector('h2');

  // Sixth tab — list view.
  await page.click('button[role="tab"]:has-text("Training manuals")');
  await page.waitForLoadState('networkidle');
  await shot(page, `${OUT}/02-super-masters-tab.png`);

  // Add form open — captures the three fields + hints.
  await page.click('button:has-text("Add training manual")');
  await shot(page, `${OUT}/03-super-masters-create-form.png`);
  await context.close();
}

async function main() {
  await ensure(OUT);
  const browser = await chromium.launch();
  await captureVcMobile(browser);
  await captureSuperMastersDesktop(browser);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
