#!/usr/bin/env node
// L2.3 screenshot harness. Covers achievements CRUD and the new
// drill-down dashboard (5 tiles x breadcrumbs x CSV button).
//
// Prereqs, run from the repo root:
//   pnpm --filter @navsahyog/api db:reset
//   pnpm --filter @navsahyog/api dev &   # 8787
//   pnpm --filter @navsahyog/web dev &   # 5173
//
// Then:
//   node scripts/capture-l2.3.mjs
//
// Outputs to mvp/screenshots/l2.3/{desktop,i18n}/*.png.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l2.3');
const BASE = 'http://localhost:5173';

const DESKTOP = { width: 1280, height: 800 };

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

async function freshContext(browser, viewport, { lang = 'en' } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.evaluate((lang) => {
    localStorage.setItem('nsf.lang', lang);
    localStorage.setItem('nsf.theme', 'light');
  }, lang);
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

async function shot(page, path) {
  await page.waitForTimeout(250);
  await page.screenshot({ path, fullPage: true });
  console.log('  →', path.replace(ROOT + '/', ''));
}

async function captureEnglishDesktop(browser) {
  const outDir = `${OUT}/desktop`;
  await ensure(outDir);

  // --- Super admin: dashboard drill-down across levels + CSV. ---
  const { context: adminCtx, page: adminPage } = await freshContext(browser, DESKTOP);
  await loginAs(adminPage, 'super');

  // 1 — india > children tile (top of the tree, 1 zone row).
  await adminPage.goto(BASE + '/dashboard');
  await adminPage.waitForSelector('h2:has-text("Drill-down dashboard")');
  await adminPage.click('button:has-text("Children")');
  await adminPage.waitForSelector('th:has-text("Zone")');
  await shot(adminPage, `${outDir}/01-dashboard-india-children.png`);

  // 2 — drill India > South Zone (by clicking the row).
  await adminPage.click('td:has-text("South Zone")');
  await adminPage.waitForSelector('th:has-text("State")');
  await shot(adminPage, `${outDir}/02-dashboard-zone-children.png`);

  // 3 — achievements tile at india level (period-scoped).
  await adminPage.click('button:has-text("Achievements")');
  await adminPage.waitForSelector('th:has-text("Total")');
  await shot(adminPage, `${outDir}/03-dashboard-india-achievements.png`);

  // 4 — drill to cluster so the per-village SoM/Gold/Silver split shows.
  await adminPage.click('td:has-text("South Zone")');
  await adminPage.waitForSelector('th:has-text("State")');
  await adminPage.click('td:has-text("Karnataka")');
  await adminPage.waitForSelector('th:has-text("Region")');
  await adminPage.click('td:has-text("South Karnataka")');
  await adminPage.waitForSelector('th:has-text("District")');
  await adminPage.click('td:has-text("Bidar")');
  await adminPage.waitForSelector('th:has-text("Cluster")');
  await adminPage.click('td:has-text("Bidar Cluster 1")');
  await adminPage.waitForSelector('th:has-text("Village")');
  await shot(adminPage, `${outDir}/04-dashboard-cluster-achievements.png`);

  // 5 — drill to leaf (village) — per-award detail rows, no further drill.
  await adminPage.click('td:has-text("Anandpur")');
  await adminPage.waitForSelector('th:has-text("Date")');
  await shot(adminPage, `${outDir}/05-dashboard-village-achievements-leaf.png`);

  // 6 — attendance tile, drilled to cluster, with period picker visible.
  // Switching tiles resets position to India, so we drill again.
  await adminPage.click('button:has-text("Attendance")');
  await adminPage.waitForSelector('th:has-text("Attendance %")');
  await adminPage.click('td:has-text("South Zone")');
  await adminPage.waitForSelector('th:has-text("State")');
  await adminPage.click('td:has-text("Karnataka")');
  await adminPage.click('td:has-text("South Karnataka")');
  await adminPage.click('td:has-text("Bidar")');
  await adminPage.click('td:has-text("Bidar Cluster 1")');
  await adminPage.waitForSelector('th:has-text("Village")');
  await shot(adminPage, `${outDir}/06-dashboard-cluster-attendance.png`);

  await adminCtx.close();

  // --- VC: achievements page (add + list). ---
  const { context: vcCtx, page: vcPage } = await freshContext(browser, DESKTOP);
  await loginAs(vcPage, 'vc-anandpur');
  await vcPage.goto(BASE + '/achievements');
  await vcPage.waitForSelector('h2:has-text("Achievements")');

  // 7 — list with seeded rows for Anandpur.
  await shot(vcPage, `${outDir}/07-achievements-list.png`);

  // 8 — open the add form.
  await vcPage.click('button:has-text("Add achievement")');
  await vcPage.waitForSelector('h3:has-text("New achievement")');
  await shot(vcPage, `${outDir}/08-achievements-add-form.png`);

  // 9 — switch the form to Gold so the medal-count field appears.
  // The form's Type select sits inside the <form> (not the filter bar).
  await vcPage.locator('form label:has(span:has-text("Type")) select').selectOption('gold');
  await vcPage.waitForSelector('input[type="number"]');
  await shot(vcPage, `${outDir}/09-achievements-add-gold.png`);

  await vcCtx.close();
}

async function captureHindi(browser) {
  const outDir = `${OUT}/i18n`;
  await ensure(outDir);
  const { context, page } = await freshContext(browser, DESKTOP, { lang: 'hi' });
  await loginAs(page, 'vc-anandpur');

  // Achievements page in Hindi.
  await page.goto(BASE + '/achievements');
  await page.waitForSelector('h2:has-text("उपलब्धियाँ")');
  await shot(page, `${outDir}/hi-achievements-list.png`);

  // Dashboard — children tile in Hindi.
  await page.goto(BASE + '/dashboard');
  await page.click('button:has-text("बच्चे")');
  await page.waitForSelector('table');
  await shot(page, `${outDir}/hi-dashboard-children.png`);

  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    console.log('desktop');
    await captureEnglishDesktop(browser);
    console.log('i18n');
    await captureHindi(browser);
    console.log('\ndone');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
