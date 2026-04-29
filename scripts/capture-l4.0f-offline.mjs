#!/usr/bin/env node
// L4.0f offline-mode capture harness (decisions.md D34).
//
// Captures three scenes at iPhone 13 mini width (375 px) as VC Belur
// (vc-belur / password):
//
//   01-online-home.png       Control: Home loaded normally with the
//                            sync chip green, proving the happy path
//                            still renders after the L4.0f changes.
//   02-offline-home.png      §3.6.4 Home offline — `OfflineUnavailable`
//                            card rendered + sync chip flipped to red
//                            "Offline". Replaces the pre-fix "stuck
//                            on loading skeleton" behaviour.
//   03-offline-dashboard.png §3.6 drill-down dashboard offline — same
//                            `OfflineUnavailable` card + red sync chip.
//
// Prereqs (same as scripts/capture-mobile-menu-fab.mjs):
//   pnpm db:reset
//   pnpm --filter @navsahyog/web build
//   pnpm --filter @navsahyog/api dev   (8787, serves dist + /api)
//
// Then:
//   node scripts/capture-l4.0f-offline.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l4.0f-offline');
const BASE = 'http://localhost:8787';

const IPHONE_13_MINI = { width: 375, height: 812 };

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log('  →', path.replace(ROOT + '/', ''));
}

async function loginAs(page, userId, password = 'password') {
  await page.goto(BASE + '/login');
  await page.evaluate(() => {
    localStorage.setItem('nsf.lang', 'en');
    localStorage.setItem('nsf.theme', 'light');
  });
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
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: IPHONE_13_MINI,
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    await loginAs(page, 'vc-belur');

    // 01 — online Home control. Wait for either the Health Score card
    // or the Mission card to anchor on the rendered surface.
    await page.goto(BASE + '/');
    await page
      .waitForSelector('text=/Health Score|Today.*Mission|My village/i', {
        timeout: 5000,
      })
      .catch(() => {});
    await shot(page, '01-online-home');

    // Going offline — Playwright's `setOffline(true)` makes every
    // fetch reject the way airplane mode does and emits the OS-level
    // `offline` event the SyncStateProvider listens for.
    await context.setOffline(true);
    // Belt-and-braces: dispatch the offline event explicitly. Some
    // headless Chromium builds skip the OS-event side of `setOffline`,
    // and the chip's `browserOnline` state listens for that event.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });
    // Wait for the chip to flip to red so the screenshot captures
    // the offline indicator alongside the OfflineUnavailable card.
    await page
      .waitForFunction(() => navigator.onLine === false, null, { timeout: 5000 })
      .catch(() => {});

    // 02 — offline Home. Switch to the 30-day preset to retrigger
    // /api/dashboard/home; that fetch fails offline → catch branch
    // sets `error` → render path picks OfflineUnavailable.
    await page.getByRole('radio', { name: '30D' }).click();
    await page
      .waitForSelector('text=/Data unavailable offline/i', { timeout: 5000 })
      .catch(() => {});
    await shot(page, '02-offline-home');

    // 03 — offline Dashboard. SPA-link click (not page.goto) so the
    // app keeps its in-memory session — a full reload while offline
    // hits /api/me which fails and bounces the user to /login. The
    // route push triggers the page's mount effect; the dashboard
    // fetch fails → same OfflineUnavailable card.
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    await page.waitForURL(/\/dashboard/);
    await page
      .waitForSelector('text=/Data unavailable offline/i', { timeout: 5000 })
      .catch(() => {});
    await shot(page, '03-offline-dashboard');

    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
