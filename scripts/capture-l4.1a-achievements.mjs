#!/usr/bin/env node
// L4.1a achievements vertical-slice capture harness.
//
// Captures four scenes at iPhone 13 mini width (375 px) as VC Belur:
//
//   01-online-form-cache.png   Achievement form with the village +
//                              student pickers populated from
//                              `cache_villages` / `cache_students`
//                              (manifest pull seeded them on login).
//   02-offline-form-cache.png  Same form offline — pickers still
//                              show data, sync chip flipped to red.
//                              Proves the read cache survives the
//                              network gap.
//   03-offline-submitted.png   Right after submitting offline —
//                              chip shows "1 queued"; Outbox screen
//                              reachable. Per principle 5, the new
//                              row is NOT in the achievements list.
//   04-online-drained.png      Network restored, drain ran, list
//                              now includes the previously-queued
//                              row.
//
// Prereqs:
//   pnpm db:reset
//   pnpm --filter @navsahyog/web build
//   pnpm --filter @navsahyog/api dev   (8787, serves dist + /api)
//
// Then:
//   node scripts/capture-l4.1a-achievements.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l4.1a-achievements');
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

async function openAchievementsForm(page) {
  // Navigate via the More menu (mobile width hides Achievements
  // behind it, post-PR #60). Open the menu, click Achievements.
  await page.getByRole('button', { name: 'More' }).click();
  await page.waitForSelector('role=menu', { timeout: 2000 });
  await page.getByRole('menuitem', { name: 'Achievements' }).click();
  await page.waitForURL(/\/achievements/);
  // Open the Add panel.
  await page.getByRole('button', { name: 'Add' }).click();
  // Wait for the form to mount (village dropdown).
  await page
    .waitForSelector('select:has(option[value="1"])', { timeout: 5000 })
    .catch(() => {});
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
    // Manifest pull fires on login; give it a moment to land in IDB
    // before we screenshot the form.
    await page.waitForTimeout(800);

    // 01 — online form, pickers populated from cache. Selects are:
    //   0 — page filter Village
    //   1 — page filter Type
    //   2 — form Village (the one we want)
    //   3 — form Student
    //   4 — form Type
    await openAchievementsForm(page);
    const formVillage = page.locator('select').nth(2);
    const formStudent = page.locator('select').nth(3);
    await formVillage.selectOption({ label: 'Belur' });
    // Student select populates from cache_students once village is
    // chosen — wait for at least one option to appear.
    await page.waitForFunction(
      () => {
        const selects = document.querySelectorAll('select');
        const studentSel = selects[3];
        return studentSel && studentSel.options.length > 1;
      },
      null,
      { timeout: 5000 },
    );
    // Pick a student so the screenshot actually shows the cached
    // student name (not the placeholder). Belur seed has Farhan Ali
    // first alphabetically; selectOption({ index: 1 }) is the first
    // real student row past the "Select a student" placeholder.
    await formStudent.selectOption({ index: 1 });
    await page.waitForTimeout(200);
    await shot(page, '01-online-form-cache');

    // Switch to offline. Cache still serves the same data; chip
    // flips red. The screenshot proves the form is fully usable
    // with no live network: village + student names render from
    // IDB (`cache_students` populated by the manifest pull).
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page
      .waitForFunction(() => navigator.onLine === false, null, { timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, '02-offline-form-cache');

    // 03 — submit offline, then navigate to the Outbox screen so
    // the queued mutation is visible. The chip shows "1 queued"
    // (its label is hidden below sm:, so the screenshot of the
    // outbox screen is the clearer demo of "the row is queued").
    await page
      .getByLabel(/Description/i)
      .fill('Star of the Month — captured offline (L4.1a screenshot).');
    await page.getByRole('button', { name: 'Save achievement' }).click();
    await page
      .waitForFunction(
        () => {
          // OUTBOX_CHANGED_EVENT bumps the chip's title; easier
          // signal: just wait until the form has closed (the
          // achievements list re-mounts, no Save button visible).
          return !document.querySelector('button[type="submit"]');
        },
        null,
        { timeout: 5000 },
      )
      .catch(() => {});
    // Navigate to the outbox screen via the sync chip — SPA-link
    // click, not a full reload (a reload while offline hits
    // /api/me, fails, and bounces to /login). The chip is wrapped
    // in a <Link to="/outbox"> so a normal click pushes the
    // router state.
    await page.locator('a[role="status"]').click();
    await page.waitForURL(/\/outbox/);
    await page
      .waitForSelector('h1:has-text("Outbox"), h2:has-text("Outbox")', {
        timeout: 5000,
      })
      .catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, '03-offline-submitted');

    // 04 — go back online, let the drain run, screenshot the list
    // with the new row.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page
      .waitForFunction(() => navigator.onLine === true, null, { timeout: 5000 })
      .catch(() => {});
    // Drain runs from the SyncStateProvider's online handler.
    // Wait for the chip to leave yellow.
    await page
      .waitForFunction(
        () =>
          !document.body.textContent?.match(/queued/i) ||
          document.body.textContent?.includes('Online'),
        null,
        { timeout: 10000 },
      )
      .catch(() => {});
    // The page's `load()` re-fetches achievements when the panel
    // closes; offline → online doesn't re-trigger a list fetch
    // automatically. Force one by clicking the achievement filter
    // refresh — easiest is to toggle a filter. Instead, just wait
    // a moment then take the screenshot of the current state.
    await page.waitForTimeout(1500);
    // Reload the page to see the achievement list refreshed via
    // the page's mount effect.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    // Navigate back into Achievements (mobile More menu hides it).
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Achievements' }).click();
    await page.waitForURL(/\/achievements/);
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
