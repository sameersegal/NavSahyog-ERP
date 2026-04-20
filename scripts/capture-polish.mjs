#!/usr/bin/env node
// Polish pass — before/after screenshot harness.
//
// Covers every surface that changed in this PR. Scenes are designed
// so the same framing renders meaningfully under both the old and
// new code (apples-to-apples): e.g. the home scene for a VC shows
// what the user sees *after login*, which in the new code is the
// village page (auto-redirect), which is itself the improvement.
//
// Run from the repo root, *after* `pnpm db:reset` and with both dev
// servers up (api on 8787, web on 5173). Output is written to
// mvp/screenshots/polish/{before,after} depending on --mode:
//
//   node scripts/capture-polish.mjs --mode before
//   node scripts/capture-polish.mjs --mode after

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = 'http://localhost:5173';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'before';
if (mode !== 'before' && mode !== 'after') {
  console.error('usage: capture-polish.mjs --mode before|after');
  process.exit(1);
}
const OUT = resolve(ROOT, `mvp/screenshots/polish/${mode}`);

async function ensure(dir) { await mkdir(dir, { recursive: true }); }

async function freshContext(browser, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.evaluate(() => {
    localStorage.setItem('nsf.lang', 'en');
    localStorage.setItem('nsf.theme', 'light');
  });
  return { context, page };
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

async function shot(page, name) {
  await page.waitForTimeout(500);
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log('  →', path.replace(ROOT + '/', ''));
}

async function main() {
  await ensure(OUT);
  const browser = await chromium.launch({ headless: true });
  try {
    // --- desktop scenes --------------------------------------------
    // 01a — VC lands. Before: useless grid with one card. After:
    // auto-redirected to the village, where work actually happens.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'vc-belur');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, '01a-home-vc-auto-redirect');
      await context.close();
    }

    // 01b — Multi-village write-tier user (AF). Exercises the KPI
    // strip + insight cards + enriched village grid + streak chip.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'af-bid01');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, '01b-home-af');
      await context.close();
    }

    // 02 — Super admin India view.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'super');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, '02-home-super');
      await context.close();
    }

    // 03 — Cluster admin.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'cluster-bid01');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, '03-home-cluster');
      await context.close();
    }

    // 04 — Attendance new session form. Belur is the seeded star
    // village with ~21 days of history, so the form has realistic
    // context.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'vc-belur');
      await page.goto(BASE + '/village/2');
      await page.waitForSelector('button:has-text("Attendance")');
      await page.locator('button:has-text("Attendance")').first().click();
      await page.waitForSelector('button:has-text("New session")');
      await page.click('button:has-text("New session")');
      await page.waitForLoadState('networkidle');
      await shot(page, '04-attendance-new-session');
      await context.close();
    }

    // 05 — Children "add" form. Showcases the collapsible alt-
    // contact section in the common (no-smartphone-needed) path.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'vc-belur');
      await page.goto(BASE + '/village/2');
      await page.waitForSelector('button:has-text("Add child")');
      await page.click('button:has-text("Add child")');
      await page.waitForLoadState('networkidle');
      await shot(page, '05-children-add-form');
      await context.close();
    }

    // 06 — Capture page. VC is single-village — before: dropdown;
    // after: read-only chip + segmented kind buttons.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'vc-belur');
      await page.goto(BASE + '/capture');
      await page.waitForSelector('h1');
      await page.waitForLoadState('networkidle');
      await shot(page, '06-capture-vc');
      await context.close();
    }

    // 07–09 — Dashboard. Period chips light up under metrics that
    // accept one; achievements drill-down shows the insight rail.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard');
      await page.waitForLoadState('networkidle');
      await shot(page, '07-dashboard-children');
      await page.click('button:has-text("Attendance")');
      await page.waitForLoadState('networkidle');
      await shot(page, '08-dashboard-attendance');
      await page.click('button:has-text("Achievements")');
      await page.waitForLoadState('networkidle');
      await shot(page, '09-dashboard-achievements');
      await context.close();
    }

    // --- mobile scenes ---------------------------------------------
    {
      const { context, page } = await freshContext(browser, MOBILE);
      await loginAs(page, 'af-bid01');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, '10-mobile-home-af');
      await context.close();
    }
    {
      const { context, page } = await freshContext(browser, MOBILE);
      await loginAs(page, 'vc-belur');
      await page.goto(BASE + '/village/2');
      await page.locator('button:has-text("Attendance")').first().click();
      await page.waitForSelector('button:has-text("New session")');
      await page.click('button:has-text("New session")');
      await page.waitForLoadState('networkidle');
      await shot(page, '11-mobile-attendance');
      await context.close();
    }

    console.log('\ndone:', OUT);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
