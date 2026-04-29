#!/usr/bin/env node
// L4.1c offline attendance capture harness.
//
// Captures four scenes at iPhone 13 mini width (375 px) as VC Belur:
//
//   01-online-attendance-tab.png    Village → Attendance tab,
//                                   sync chip green. New session
//                                   form open with events +
//                                   children populated from cache.
//   02-offline-form-cache.png       Same tab + form, offline.
//                                   Picker still works (events
//                                   from cache_events, children
//                                   from cache_students). Chip red.
//   03-offline-queued.png           After submit, the Outbox screen
//                                   shows the queued
//                                   POST /api/attendance row.
//   04-online-drained.png           Network restored, drain ran.
//                                   The session is on the server;
//                                   a refreshed Attendance tab
//                                   shows it in the session list.
//
// Prereqs:
//   pnpm db:reset
//   pnpm --filter @navsahyog/web build
//   pnpm --filter @navsahyog/api dev   (8787, serves dist + /api)
//
// Then:
//   node scripts/capture-l4.1c-attendance.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l4.1c-attendance');
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
    // Manifest pull fires on login — give it time to populate
    // cache_villages / cache_students / cache_events.
    await page.waitForTimeout(800);

    // Land on /village/2 → Attendance tab via deep link.
    await page.goto(BASE + '/village/2?tab=attendance');
    await page.waitForLoadState('networkidle');
    await page
      .waitForSelector('text=/Attendance|New session/i', { timeout: 5000 })
      .catch(() => {});

    // Open the new-session form.
    await page.getByRole('button', { name: /New session/i }).click();
    await page.waitForTimeout(400);
    await shot(page, '01-online-attendance-tab');

    // Switch offline.
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page
      .waitForFunction(() => navigator.onLine === false, null, { timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, '02-offline-form-cache');

    // Submit. The default form has every child marked present and
    // a default time. Click the Save button — i18n key
    // `attendance.save_session`.
    await page.getByRole('button', { name: /Save attendance/i }).click();
    await page
      .waitForFunction(
        () => !document.querySelector('button[type="submit"]'),
        null,
        { timeout: 5000 },
      )
      .catch(() => {});

    // Navigate to /outbox via the sync chip (SPA-link click).
    await page.locator('a[role="status"]').click();
    await page.waitForURL(/\/outbox/);
    await page
      .waitForSelector('h1:has-text("Outbox"), h2:has-text("Outbox")', {
        timeout: 5000,
      })
      .catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, '03-offline-queued');

    // Back online.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page
      .waitForFunction(() => navigator.onLine === true, null, { timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(2000);

    // Reload the village attendance tab to see the new session.
    await page.goto(BASE + '/village/2?tab=attendance');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await shot(page, '04-online-drained');

    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
