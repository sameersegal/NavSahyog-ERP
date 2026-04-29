#!/usr/bin/env node
// Mobile menu compression + FAB long-press screenshot harness for
// the PR on claude/fix-mobile-menu-overflow-oG6S5.
//
// Captures four scenes at iPhone 13 mini width (375 px) as logged-in
// VC Belur (vc-belur / password):
//
//   01-mobile-home.png        Compressed header — logo only (no
//                             word-mark below sm:), 4 inline nav
//                             items + More, sync chip dot + user
//                             avatar both visible at the right edge.
//   02-mobile-more-open.png   More menu open showing folded
//                             secondary destinations (Ponds /
//                             Training).
//   03-mobile-fab-menu.png    FAB long-press → Quick Actions menu
//                             (Mark attendance · Add Star of the
//                             Month · Capture photo / video).
//   04-mobile-village-attendance.png
//                             FAB tap landing on
//                             /village/2?tab=attendance — the
//                             attendance pane open via the new
//                             query-param deep-link.
//
// Prereqs:
//   pnpm db:reset
//   pnpm --filter @navsahyog/web build
//   pnpm --filter @navsahyog/api dev   (8787, serves dist + /api)
//
// Then:
//   node scripts/capture-mobile-menu-fab.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/mobile-menu-fab');
const BASE = 'http://localhost:8787';

// iPhone 13 mini CSS viewport — same baseline as L2.5.
const IPHONE_13_MINI = { width: 375, height: 812 };

async function ensure(dir) { await mkdir(dir, { recursive: true }); }

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
    await page.goto(BASE + '/');
    // Wait for the Health Score card so the page has settled.
    await page.waitForSelector('text=/Health Score|Today.*Mission|My village/i', { timeout: 5000 }).catch(() => {});
    await shot(page, '01-mobile-home');

    // 02 — More dropdown open.
    await page.getByRole('button', { name: 'More' }).click();
    await page.waitForSelector('role=menu', { timeout: 2000 });
    await shot(page, '02-mobile-more-open');
    // Close it again before triggering the FAB long-press.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // 03 — FAB long-press → Quick Actions menu. Playwright doesn't
    // ship a "long press" primitive; emulate by dispatching a
    // pointerdown on the FAB anchor and waiting > LONG_PRESS_MS
    // (500) before pointerup. The component's timer fires at 500 ms
    // and opens the menu; the synthetic click that follows is
    // suppressed by the longPressFiredRef path.
    const fab = page.getByRole('link', { name: 'Log' });
    await fab.waitFor({ state: 'visible' });
    const box = await fab.boundingBox();
    if (!box) throw new Error('FAB has no bounding box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await shot(page, '03-mobile-fab-menu');
    await page.mouse.up();
    await page.waitForTimeout(150);

    // 04 — FAB tap → /village/2?tab=attendance. Close any open menu
    // first, then click the FAB normally so the primary tap path
    // fires (no long-press timer engagement).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await fab.click();
    await page.waitForURL(/\/village\/2/);
    // Wait for the attendance pane: the per-date filter pills are a
    // tab-only surface, so they confirm we're on the right tab.
    await page.waitForSelector('text=/Today|Yesterday|Day before/i', { timeout: 5000 }).catch(() => {});
    await shot(page, '04-mobile-village-attendance');

    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
