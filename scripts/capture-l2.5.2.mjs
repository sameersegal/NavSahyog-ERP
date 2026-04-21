#!/usr/bin/env node
// L2.5.2 — scope quick-pick + sibling-jump + mobile card view.
//
// Captures the dashboard at iPhone 13 mini CSS size (375×812) so
// the mobile polish is visible; adds a desktop scene to prove the
// table layout still holds at sm+.
//
// Run from the repo root, after `pnpm db:reset` and with both dev
// servers up (api on 8787, web on 5173).
//
//   node scripts/capture-l2.5.2.mjs --mode before
//   node scripts/capture-l2.5.2.mjs --mode after

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
  console.error('usage: capture-l2.5.2.mjs --mode before|after');
  process.exit(1);
}
const OUT = resolve(ROOT, `mvp/screenshots/l2.5.2/${mode}`);

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
    // 01 — Scope quick-pick typeahead with results. Exercise a
    // common query that hits >1 village on the seed so the
    // result rows render visibly.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard');
      await page.waitForLoadState('networkidle');
      const picker = await page.$('input[type="search"]');
      if (picker) {
        await picker.click();
        await picker.type('an', { delay: 80 });
        await page.waitForTimeout(500);
      }
      await shot(page, '01-scope-search-typeahead');
      await context.close();
    }

    // 02 — Sibling-jump dropdown open on a breadcrumb. Navigate
    // straight to a state-level URL so the breadcrumb carries
    // zone + state crumbs with sibling chevrons. Direct URL entry
    // avoids the networkidle-races-React-re-render flakiness of
    // two sequential drill clicks.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard?level=state&id=1');
      await page
        .locator('button[aria-label^="Siblings of"]')
        .first()
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => {});
      if (mode === 'after') {
        const chev = page.locator('button[aria-label^="Siblings of"]').first();
        if (await chev.count()) {
          await chev.click();
          await page
            .locator('[role="listbox"]')
            .waitFor({ state: 'visible', timeout: 5000 })
            .catch(() => {});
          await page.waitForTimeout(600);
        }
      }
      await shot(page, '02-sibling-jump-open');
      await context.close();
    }

    // 03 — Mobile card view for the leaf (village) children
    // metric. Demonstrates that the table renders as a stack of
    // cards below sm, instead of relying on overflow-x-auto.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard?metric=children&level=village&id=1');
      await page.waitForLoadState('networkidle');
      await shot(page, '03-mobile-card-children-leaf');
      await context.close();
    }

    // 04 — Mobile card view for an aggregate level (Attendance at
    // cluster level). Shows percent + present/marked columns as
    // label/value pairs.
    {
      const { context, page } = await freshContext(browser, IPHONE_13_MINI);
      await loginAs(page, 'super');
      const firstMonth = new Date().toISOString().slice(0, 8) + '01';
      const today = new Date().toISOString().slice(0, 10);
      await page.goto(
        `${BASE}/dashboard?metric=attendance&level=india&from=${firstMonth}&to=${today}`,
      );
      await page.waitForLoadState('networkidle');
      await shot(page, '04-mobile-card-attendance-aggregate');
      await context.close();
    }

    // 05 — Desktop table layout still intact at 1280×900. Quick
    // sanity to show we haven't regressed the wider viewport.
    {
      const { context, page } = await freshContext(browser, DESKTOP);
      await loginAs(page, 'super');
      await page.goto(BASE + '/dashboard');
      await page.waitForLoadState('networkidle');
      await shot(page, '05-desktop-dashboard-default');
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
