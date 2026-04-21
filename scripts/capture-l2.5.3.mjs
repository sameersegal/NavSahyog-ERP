#!/usr/bin/env node
// L2.5.3 — consolidated KPI pack + attendance trend on the
// drill-down dashboard (§3.6.2, decisions.md D12–D14).
//
// Captures the dashboard at iPhone 13 mini (375×812) plus a
// desktop 1280×900 sanity shot.
//
// Run from the repo root after `pnpm db:reset`, with both dev
// servers up (api 8787, web 5173):
//
//   node scripts/capture-l2.5.3.mjs --mode before
//   node scripts/capture-l2.5.3.mjs --mode after

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = 'http://localhost:5173';
const IPHONE_13_MINI = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'after';
if (mode !== 'before' && mode !== 'after') {
  console.error('usage: capture-l2.5.3.mjs --mode before|after');
  process.exit(1);
}
const OUT = resolve(ROOT, `mvp/screenshots/l2.5.3/${mode}`);

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
    // 01 — India root (default). Consolidated KPI pack + 6-month
    // trend above the metric table. The strip sits at the top of
    // the scope rather than being home-root-only.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard');
      await page.waitForLoadState('networkidle');
      await shot(page, '01-india-consolidated');
      await context.close();
    }

    // 02 — Cluster scope with the "View more" anchor. Uses the
    // seed's only cluster (Bidar Cluster 1); ScopePicker in real
    // data would land here in one tap.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard?level=cluster&id=1');
      await page.waitForLoadState('networkidle');
      await shot(page, '02-cluster-view-more');
      await context.close();
    }

    // 03 — Metric switched to Attendance at cluster scope. Tile
    // selection preserves the drill (L2.5.3 acceptance #5) — URL
    // updates `metric=attendance` but keeps `level=cluster&id=1`.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard?level=cluster&id=1&metric=attendance');
      await page.waitForLoadState('networkidle');
      await shot(page, '03-cluster-attendance');
      await context.close();
    }

    // 04 — Village leaf. Per-student detail in the table; the
    // KPI pack still renders but the 6-month chart is suppressed
    // (per-village rollup is too noisy at this zoom).
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard?level=village&id=1');
      await page.waitForLoadState('networkidle');
      await shot(page, '04-village-leaf');
      await context.close();
    }

    // 05 — Desktop sanity shot at 1280×900. The KPI strip grows
    // to 5 columns; the trend chart keeps its compact layout.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard');
      await page.waitForLoadState('networkidle');
      await shot(page, '05-desktop-consolidated');
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
