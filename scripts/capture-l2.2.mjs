#!/usr/bin/env node
// L2.2 screenshot harness. Focused on the attendance surfaces that
// changed: empty attendance tab, new-session form, two-sessions list,
// edit-in-place, and the updated dashboard. Mirrors the L1 harness
// conventions (fresh localStorage context, chromium headless, two
// viewports) but narrow in scope.
//
// Prereqs, run from the repo root:
//   pnpm --filter @navsahyog/api db:reset
//   pnpm --filter @navsahyog/api dev &   # 8787
//   pnpm --filter @navsahyog/web dev &   # 5173
//
// Then:
//   node scripts/capture-l2.2.mjs
//
// Outputs to mvp/screenshots/l2.2/{desktop,mobile,i18n}/*.png.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l2.2');
const BASE = 'http://localhost:5173';
const API = 'http://localhost:8787';

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

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

// Seed two attendance sessions for village 1 by driving the API.
// Keeps the screenshots deterministic regardless of wall clock.
async function seedTwoSessions(page) {
  const result = await page.evaluate(async (api) => {
    // Already authenticated via the cookie jar.
    async function post(body) {
      const res = await fetch(api + '/api/attendance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    }
    const one = await post({
      village_id: 1,
      event_id: 3, // Board Games
      start_time: '10:00',
      end_time: '11:00',
      marks: [
        { student_id: 1, present: true },
        { student_id: 2, present: true },
        { student_id: 3, present: false },
        { student_id: 4, present: true },
        { student_id: 5, present: true },
        { student_id: 6, present: false },
        { student_id: 7, present: true },
      ],
    });
    const two = await post({
      village_id: 1,
      event_id: 4, // Running Race
      start_time: '14:00',
      end_time: '15:00',
      marks: [
        { student_id: 1, present: true },
        { student_id: 2, present: false },
        { student_id: 3, present: true },
        { student_id: 4, present: true },
        { student_id: 5, present: true },
        { student_id: 6, present: true },
        { student_id: 7, present: true },
      ],
    });
    return { one, two };
  }, API);
  if (result.one.status !== 200 || result.two.status !== 200) {
    throw new Error('seed failed: ' + JSON.stringify(result));
  }
}

async function clearSessionsForVillage1(page) {
  // D1 has no delete route; simplest reset is to log in as super,
  // then use the API to reset. The harness callers instead re-run
  // `pnpm db:reset` when they need a clean slate. This helper just
  // navigates back to a neutral state.
  await page.goto(BASE + '/');
  await page.waitForSelector('h2');
}

async function captureEnglishFlow(browser, viewport, subdir) {
  const outDir = `${OUT}/${subdir}`;
  await ensure(outDir);
  const { context, page } = await freshContext(browser, viewport);

  await loginAs(page, 'vc-anandpur');

  // 1 — empty attendance tab for today.
  await page.goto(BASE + '/village/1');
  await page.click('button:has-text("Attendance")');
  await page.waitForSelector('text=No sessions captured for this date yet.');
  await shot(page, `${outDir}/01-attendance-empty.png`);

  // 2 — open the new-session form.
  await page.click('button:has-text("New session")');
  await page.waitForSelector('text=New attendance session');
  await shot(page, `${outDir}/02-attendance-new-session.png`);

  // Cancel back out, then seed two sessions and re-render.
  await page.click('button:has-text("Cancel")');
  await seedTwoSessions(page);
  await page.goto(BASE + `/village/1`);
  await page.click('button:has-text("Attendance")');
  await page.waitForSelector('text=Board Games');

  // 3 — two sessions in one day.
  await shot(page, `${outDir}/03-attendance-two-sessions.png`);

  // 4 — edit the first session (in-place).
  await page.click('li:has-text("Board Games") >> button:has-text("Edit")');
  await page.waitForSelector('text=Edit attendance session');
  await shot(page, `${outDir}/04-attendance-edit-session.png`);
  await page.click('button:has-text("Cancel")');

  // 5 — dashboard with the new `sessions` column populated.
  await page.goto(BASE + '/dashboard');
  await page.click('button:has-text("Attendance")');
  await page.waitForSelector('th:has-text("Present")');
  await shot(page, `${outDir}/05-dashboard-attendance.png`);

  await context.close();
}

async function captureHindiFlow(browser) {
  const outDir = `${OUT}/i18n`;
  await ensure(outDir);
  const { context, page } = await freshContext(browser, DESKTOP, { lang: 'hi' });
  await loginAs(page, 'vc-anandpur');

  await page.goto(BASE + '/village/1');
  await page.click('button:has-text("उपस्थिति")');
  await page.waitForSelector('text=इस तिथि पर अभी कोई सत्र दर्ज नहीं।');
  await shot(page, `${outDir}/hi-attendance-empty.png`);

  await page.click('button:has-text("नया सत्र")');
  await page.waitForSelector('text=नया उपस्थिति सत्र');
  await shot(page, `${outDir}/hi-attendance-new-session.png`);

  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    // Hindi runs first because its "empty attendance" shot needs a
    // clean DB. The English flow below seeds two sessions mid-run,
    // which would otherwise leak into the Hindi capture.
    console.log('i18n');
    await captureHindiFlow(browser);
    console.log('desktop');
    await captureEnglishFlow(browser, DESKTOP, 'desktop');
    console.log('\ndone');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
