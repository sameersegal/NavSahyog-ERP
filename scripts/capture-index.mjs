#!/usr/bin/env node
// One-off: snapshot the reworked index (Home) page for the
// sparklines + SOM-tile + 1-col-mobile pass. Run from the repo
// root with both dev servers up (api on 8787, web on 5173):
//
//   node scripts/capture-index.mjs
//
// Output lands in mvp/screenshots/index/. Four scenes: AF desktop,
// super-admin desktop, AF mobile, cluster-admin desktop.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = 'http://localhost:5173';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

const OUT = resolve(ROOT, 'mvp/screenshots/index');

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
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'af-bid01');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, 'desktop-af');
      await context.close();
    }
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'super');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, 'desktop-super');
      // Drill: India → zone 1 → its first state. Seed has zone 1
      // (Karnataka / Tamil Nadu) with state 1 underneath; these
      // URLs always resolve in the lab fixture.
      await page.goto(BASE + '/?level=zone&id=1');
      await page.waitForLoadState('networkidle');
      await shot(page, 'desktop-super-zone');
      await page.goto(BASE + '/?level=state&id=1');
      await page.waitForLoadState('networkidle');
      await shot(page, 'desktop-super-state');
      await page.goto(BASE + '/?level=district&id=1');
      await page.waitForLoadState('networkidle');
      await shot(page, 'desktop-super-district');
      await context.close();
    }
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'cluster-bid01');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, 'desktop-cluster');
      await context.close();
    }
    {
      const { context, page } = await freshContext(browser, MOBILE);
      await loginAs(page, 'af-bid01');
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      await shot(page, 'mobile-af');
      await context.close();
    }
    console.log('\ndone:', OUT);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
