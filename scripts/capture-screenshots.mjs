#!/usr/bin/env node
// Screenshot harness — template. Drives headless chromium against
// the local dev stack and captures reference images for a PR body.
//
// This file currently still implements the L1 capture set
// (desktop, mobile, themes, i18n). It's kept as a working
// reference: copy this file, change `OUT` to the target subdir
// under `mvp/screenshots/`, and rewrite the per-shot bodies for
// the new screen / flow. Delete the copy when the PR ships — the
// PNGs are the lasting artefact, the script is throwaway.
//
// Prereqs, run from the repo root:
//   pnpm db:reset
//   pnpm --filter @navsahyog/api dev &   # 8787
//   pnpm --filter @navsahyog/web dev &   # 5173
//
// Then:
//   node scripts/capture-screenshots.mjs
//
// Outputs to mvp/screenshots/l1/{desktop,mobile,themes,i18n}/*.png.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l1');
const BASE = 'http://localhost:5173';

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

async function freshContext(browser, viewport, { lang = 'en', theme = 'light' } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  // Pre-seed localStorage so the app comes up in the right mode.
  // We visit the origin first so `localStorage` is scoped correctly.
  await page.goto(BASE + '/login');
  await page.evaluate(
    ({ lang, theme }) => {
      localStorage.setItem('nsf.lang', lang);
      localStorage.setItem('nsf.theme', theme);
    },
    { lang, theme },
  );
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
  await page.waitForTimeout(250); // let animations settle
  await page.screenshot({ path, fullPage: false });
  console.log('  →', path.replace(ROOT + '/', ''));
}

async function captureCoreFlow(browser, viewport, subdir, opts = {}) {
  const outDir = `${OUT}/${subdir}`;
  await ensure(outDir);
  const { context, page } = await freshContext(browser, viewport, opts);

  // 1 — login (unauthenticated)
  await page.goto(BASE + '/login');
  await page.waitForSelector('form');
  await shot(page, `${outDir}/01-login.png`);

  // 2 — home (super admin)
  await loginAs(page, 'super');
  await page.waitForSelector('h2');
  await shot(page, `${outDir}/02-home.png`);

  // 3 — village > children
  await page.goto(BASE + '/village/1');
  await page.waitForSelector('text=/Children|Aarav|बच्चे/');
  await shot(page, `${outDir}/03-village-children.png`);

  // 4 — village > attendance
  await page.click('button:has-text("Attendance (today)"), button:has-text("उपस्थिति (आज)")');
  await page.waitForSelector('text=/Mark all present|सभी को उपस्थित/');
  await shot(page, `${outDir}/04-village-attendance.png`);

  // 5 — dashboard > children
  await page.goto(BASE + '/dashboard');
  await page.waitForSelector('text=/Total children|कुल बच्चे/');
  await shot(page, `${outDir}/05-dashboard-children.png`);

  // 6 — dashboard > attendance
  await page.click('button:has-text("Attendance (today)"), button:has-text("उपस्थिति (आज)")');
  await page.waitForSelector('th:has-text("Present"), th:has-text("उपस्थित")');
  await shot(page, `${outDir}/06-dashboard-attendance.png`);

  // 7 — user menu open
  await page.goto(BASE + '/');
  await page.waitForSelector('button[aria-haspopup="menu"]');
  await page.click('button[aria-haspopup="menu"]');
  await page.waitForSelector('[role="menu"]');
  await shot(page, `${outDir}/07-user-menu.png`);

  await context.close();
}

async function captureThemes(browser) {
  const outDir = `${OUT}/themes`;
  await ensure(outDir);
  for (const theme of ['light', 'dark', 'sunlight']) {
    const { context, page } = await freshContext(browser, DESKTOP, { theme });
    await loginAs(page, 'super');
    await shot(page, `${outDir}/home-${theme}.png`);

    await page.goto(BASE + '/village/1');
    await page.waitForSelector('button:has-text("Attendance (today)")');
    await page.click('button:has-text("Attendance (today)")');
    await page.waitForSelector('text=Mark all present');
    await shot(page, `${outDir}/attendance-${theme}.png`);

    await page.goto(BASE + '/dashboard');
    await page.waitForSelector('text=Total children');
    await shot(page, `${outDir}/dashboard-${theme}.png`);

    await context.close();
  }
}

async function captureI18n(browser) {
  const outDir = `${OUT}/i18n`;
  await ensure(outDir);
  const { context, page } = await freshContext(browser, DESKTOP, { lang: 'hi' });

  await page.goto(BASE + '/login');
  await page.waitForSelector('form');
  await shot(page, `${outDir}/hi-login.png`);

  await loginAs(page, 'super');
  await page.click('button[aria-haspopup="menu"]');
  await page.waitForSelector('[role="menu"]');
  await shot(page, `${outDir}/hi-user-menu.png`);
  // Close the menu before navigating further.
  await page.keyboard.press('Escape');

  await page.goto(BASE + '/village/1');
  await page.waitForSelector('button:has-text("उपस्थिति (आज)")');
  await page.click('button:has-text("उपस्थिति (आज)")');
  await page.waitForSelector('text=सभी उपस्थित');
  await shot(page, `${outDir}/hi-attendance.png`);

  await page.goto(BASE + '/dashboard');
  await page.waitForSelector('text=कुल बच्चे');
  await shot(page, `${outDir}/hi-dashboard.png`);

  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    console.log('desktop');
    await captureCoreFlow(browser, DESKTOP, 'desktop');
    console.log('mobile');
    await captureCoreFlow(browser, MOBILE, 'mobile');
    console.log('themes');
    await captureThemes(browser);
    console.log('i18n');
    await captureI18n(browser);
    console.log('\ndone');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
