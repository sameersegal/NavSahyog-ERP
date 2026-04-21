#!/usr/bin/env node
// L2.5.1 dashboard polish — screenshot harness.
//
// Captures the drill-down dashboard at iPhone 13 mini CSS size
// (375×812). Focuses on the surfaces L2.5.1 touches: the custom
// date drawer (stacked inputs + single-day toggle) and the
// URL-backed state (visible in the address bar after interaction).
//
// Scenes render identically on before/after; the differences show
// up in layout (overflow, stacking) and in the URL after clicking.
//
// Run from the repo root, after `pnpm db:reset` and with both dev
// servers up (api on 8787, web on 5173). Output goes to
// mvp/screenshots/l2.5.1/{before,after} depending on --mode:
//
//   node scripts/capture-l2.5.1.mjs --mode before
//   node scripts/capture-l2.5.1.mjs --mode after

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = 'http://localhost:5173';

// iPhone 13 mini CSS viewport. Matches the baseline target in
// mvp/level-2.5.md.
const IPHONE_13_MINI = { width: 375, height: 812 };

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'after';
if (mode !== 'before' && mode !== 'after') {
  console.error('usage: capture-l2.5.1.mjs --mode before|after');
  process.exit(1);
}
const OUT = resolve(ROOT, `mvp/screenshots/l2.5.1/${mode}`);

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
  await page.waitForTimeout(400);
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log('  →', path.replace(ROOT + '/', ''));
}

async function main() {
  await ensure(OUT);
  const browser = await chromium.launch({ headless: true });
  try {
    // 01 — Dashboard default (children metric, India, no period).
    // Sanity: nothing wraps or overflows at 375px.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard');
      await page.waitForLoadState('networkidle');
      await shot(page, '01-dashboard-default');
      await context.close();
    }

    // 02 — Attendance metric, "This month" preset. Shows period
    // filter bar in the default preset state.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard?metric=attendance');
      await page.waitForLoadState('networkidle');
      await shot(page, '02-dashboard-attendance-this-month');
      await context.close();
    }

    // 03 — Attendance + Custom preset, range mode. Navigated via
    // URL params (honoured on `after`; silently ignored on
    // `before`, which itself is the regression L2.5.1 fixes). On
    // `after` the custom drawer renders with stacked date inputs
    // and the Single-day toggle; on `before` the page shows the
    // default scope/range because URL state doesn't round-trip.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard?metric=attendance&from=2026-03-15&to=2026-04-10');
      await page.waitForLoadState('networkidle');
      await shot(page, '03-dashboard-attendance-custom-range');
      await context.close();
    }

    // 04 — Attendance + Custom + single-day mode (from===to).
    // Same URL-param mechanism. On `after` the Single-day toggle
    // is automatically on (from===to) and only one input shows;
    // on `before` the URL is ignored so the scene is functionally
    // identical to 02.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard?metric=attendance&from=2026-04-15&to=2026-04-15');
      await page.waitForLoadState('networkidle');
      if (mode === 'after') {
        const box = await page.$('input[type="checkbox"]');
        if (box) {
          const checked = await box.isChecked();
          if (!checked) await box.click();
          await page.waitForTimeout(200);
        }
      }
      await shot(page, '04-dashboard-attendance-single-day');
      await context.close();
    }

    // 05 — Drill into a zone, then refresh, to prove URL state
    // persistence. After: the breadcrumb shows "India / South Zone"
    // after reload. Before: state resets to India (the regression
    // L2.5.1 fixes).
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard');
      await page.waitForLoadState('networkidle');
      const firstRow = await page.$('tbody tr.cursor-pointer');
      if (firstRow) {
        await firstRow.click();
        await page.waitForLoadState('networkidle');
        await page.reload();
        await page.waitForLoadState('networkidle');
      }
      await shot(page, '05-dashboard-drill-then-refresh');
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
