#!/usr/bin/env node
// L4.1b offline child creation capture harness (D35).
//
// Captures four scenes at iPhone 13 mini width (375 px) as VC Belur:
//
//   01-online-village-children.png  Village page → Children tab,
//                                   sync chip green. Baseline list
//                                   from the server (no offline-
//                                   created child yet).
//   02-offline-add-form.png         Add child form open while
//                                   offline, sync chip red. The
//                                   form itself is online-rendered
//                                   chrome (school picker uses
//                                   api.schools, not cache); this
//                                   screenshot just establishes the
//                                   offline-state context.
//   03-offline-queued.png           After submitting offline → the
//                                   Outbox screen shows the queued
//                                   POST /api/children mutation.
//                                   Per D35 visibility-after-sync,
//                                   the child does NOT appear in
//                                   the Children list.
//   04-online-drained.png           Network restored, drain ran,
//                                   manifest pulled, list refreshed.
//                                   The new child is now visible.
//
// Prereqs:
//   pnpm db:reset
//   pnpm --filter @navsahyog/web build
//   pnpm --filter @navsahyog/api dev   (8787, serves dist + /api)
//
// Then:
//   node scripts/capture-l4.1b-child-create.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l4.1b-child-create');
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
    // Manifest pull fires on login.
    await page.waitForTimeout(800);

    // Navigate to /village/2 (Belur), Children tab.
    await page.goto(BASE + '/village/2');
    await page.waitForLoadState('networkidle');
    await page
      .waitForSelector('text=/Children/i', { timeout: 5000 })
      .catch(() => {});
    await shot(page, '01-online-village-children');

    // Open the Add child form.
    await page.getByRole('button', { name: 'Add child' }).click();
    // Wait for the form's first_name input to mount.
    await page
      .waitForSelector('input[required]', { timeout: 5000 })
      .catch(() => {});

    // Switch to offline before filling — proves the form is usable
    // while offline (school picker is the one piece that needs
    // network at present; if it's already loaded, fine).
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page
      .waitForFunction(() => navigator.onLine === false, null, { timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, '02-offline-add-form');

    // Fill the form. Required fields: first_name, last_name, gender,
    // dob, school_id (auto-selected if there's only one), and at
    // least one parent name. We add the father with a smartphone so
    // the §3.2.2 alt-contact rule doesn't fire.
    await page.getByLabel(/First name/i).fill('Captured');
    await page.getByLabel(/Last name/i).fill('Offline');
    await page.getByLabel('DOB').fill('2018-05-12');
    // Father block — name + phone + smartphone toggle. Two
    // "Has a smartphone" checkboxes exist (father's + mother's);
    // pick the first which is the father's per render order.
    await page.getByLabel(/Father.*name/i).fill('Ramesh Captured');
    await page.getByLabel(/Father.*phone/i).fill('9988776655');
    await page
      .getByLabel('Has a smartphone')
      .first()
      .check()
      .catch(() => {});

    // Submit.
    await page.getByRole('button', { name: /Save|Add child/ }).click();
    // The form closes on success; the parent list re-fetches —
    // offline, the list won't show the new child (D35 rule).
    await page.waitForTimeout(800);

    // Navigate to /outbox via the sync chip (SPA-link click —
    // a full reload would hit /api/me and bounce to /login).
    await page.locator('a[role="status"]').click();
    await page.waitForURL(/\/outbox/);
    await page
      .waitForSelector('text=/Outbox/i', { timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, '03-offline-queued');

    // 04 — go online, let the drain run, then back to /village/2
    // children to see the synced row.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page
      .waitForFunction(() => navigator.onLine === true, null, { timeout: 5000 })
      .catch(() => {});
    // Drain runs from the SyncStateProvider's online handler.
    await page
      .waitForFunction(
        () => {
          const text = document.body.textContent || '';
          return !text.match(/will retry/i);
        },
        null,
        { timeout: 10000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1500);

    // Reload the village page to refresh the children list. We're
    // online again so /api/me works.
    await page.goto(BASE + '/village/2');
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
