#!/usr/bin/env node
// KPI dot-grid — before/after screenshots.
//
// Scene 1 (desktop): home page for the super admin at india scope —
// full KPI strip where the dot grid replaces sparklines.
// Scene 2 (mobile): same page at a 390px viewport so we can confirm
// the grid still fits inside a phone-width tile.
//
// Usage (from repo root, both dev servers up):
//   node scripts/capture-kpi-dots.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = 'http://localhost:5173';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const OUT = resolve(ROOT, 'mvp/screenshots/kpi-dots');

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

async function shot(page, name) {
  await page.waitForTimeout(600);
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log('  →', path.replace(ROOT + '/', ''));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    // Desktop — full home page. The KPI strip is the top section, so
    // the viewport catches it without scrolling.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'super');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, 'home-desktop');
      await context.close();
    }

    // Mobile — phone-width tile stack. Confirms the 12×7 grid
    // doesn't break the single-column layout.
    {
      const { context, page } = await freshContext(browser, MOBILE);
      await loginAs(page, 'super');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, 'home-mobile');
      await context.close();
    }

    // Desktop zoom — cropped on the KPI strip for a clearer look at
    // the grid pattern in the PR body.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'super');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(600);
      const strip = await page.locator('section').first();
      const path = `${OUT}/kpi-strip.png`;
      await strip.screenshot({ path });
      console.log('  →', path.replace(ROOT + '/', ''));
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
