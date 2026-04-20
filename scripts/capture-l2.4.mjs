#!/usr/bin/env node
// L2.4 screenshot harness — media pipeline.
// Covers: PhotoPicker on the child form, VoiceNoteRecorder on the
// attendance form, village media gallery, and the /capture page in
// both English and Hindi.
//
// Prereqs, run from the repo root:
//   pnpm --filter @navsahyog/api db:reset
//   pnpm --filter @navsahyog/api dev &   # 8787
//   pnpm --filter @navsahyog/web dev &   # 5173
//
// Then:
//   node scripts/capture-l2.4.mjs
//
// Outputs to mvp/screenshots/l2.4/{desktop,i18n}/*.png. The script
// performs one real upload (a tiny fixture PNG) so the village
// gallery + /capture recent-uploads panel render with live data —
// MediaRecorder can't be easily faked headless, so audio / video
// states are captured with the preview chrome but no actual
// recording.

import { chromium } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l2.4');
const FIXTURE_DIR = resolve(ROOT, '.tmp-l2.4-fixtures');
const BASE = 'http://localhost:5173';

const DESKTOP = { width: 1280, height: 800 };

// 2x2 PNG. Small enough to ship in-file, large enough that the list
// thumbnail has real pixel data rather than a single colour.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAG0lEQVQI12P8z8DAwMDAxMDAwMDEwMDAwADEAA0kAsnhDQmtAAAAAElFTkSuQmCC';

async function ensure(dir) { await mkdir(dir, { recursive: true }); }

async function writeFixtures() {
  await ensure(FIXTURE_DIR);
  const pngPath = resolve(FIXTURE_DIR, 'sample.png');
  await writeFile(pngPath, Buffer.from(PNG_BASE64, 'base64'));
  return { pngPath };
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
  await page.waitForTimeout(300);
  await page.screenshot({ path, fullPage: true });
  console.log('  →', path.replace(ROOT + '/', ''));
}

async function captureEnglishDesktop(browser, fixtures) {
  const outDir = `${OUT}/desktop`;
  await ensure(outDir);

  const { context, page } = await freshContext(browser, DESKTOP);
  await loginAs(page, 'vc-anandpur');

  // 1 — Child "add" form with the photo picker section visible but
  // no photo selected. Demonstrates the "Add photo" CTA + hint.
  await page.goto(BASE + '/village/1');
  await page.waitForSelector('h1:has-text("Anandpur")');
  await page.click('button:has-text("Add child")');
  await page.waitForSelector('legend:has-text("Photo")');
  // Pre-fill the required fields so the form doesn't scream validation.
  await page.fill('input[required]:nth-of-type(1)', 'Asha');
  await shot(page, `${outDir}/01-child-form-photo-empty.png`);

  // 2 — Upload a photo through the hidden input. The preview tile
  // swaps from "No photo" to the uploaded thumbnail.
  const chooser = page.waitForEvent('filechooser');
  await page.click('button:has-text("Add photo")');
  const fc = await chooser;
  await fc.setFiles(fixtures.pngPath);
  // Wait for upload: button label returns to "Replace photo".
  await page.waitForSelector('button:has-text("Replace photo")', { timeout: 15_000 });
  await shot(page, `${outDir}/02-child-form-photo-attached.png`);

  // Cancel out so we don't pollute the student list.
  await page.click('button:has-text("Cancel")');

  // 3 — Attendance form with the voice-note recorder row. The hint
  // text shows even without a recording; that's the state we shoot.
  // The Attendance tab button and the "New session" button are both
  // inside the same page; tab first.
  await page.locator('button:has-text("Attendance")').first().click();
  await page.waitForSelector('button:has-text("New session")');
  await page.click('button:has-text("New session")');
  await page.waitForSelector('legend:has-text("Voice note")');
  await shot(page, `${outDir}/03-attendance-form-voice-note.png`);

  // 4 — Village media gallery. The photo uploaded in step 2 lives in
  // village 1's scope, so the gallery is no longer empty.
  await page.click('button:has-text("Media")');
  await page.waitForSelector('li img, p:has-text("No media")');
  await shot(page, `${outDir}/04-village-media-gallery.png`);

  // 5 — /capture page, photo mode (default). Tag picker + village
  // picker visible; VC sees their own village locked in.
  await page.goto(BASE + '/capture');
  await page.waitForSelector('h1:has-text("Capture")');
  await shot(page, `${outDir}/05-capture-photo.png`);

  // 6 — /capture page, audio mode. Shows the Record CTA; no actual
  // recording (headless mic isn't worth the complexity for a PR
  // screenshot).
  await page.locator('label:has-text("Kind") select').selectOption('audio');
  await page.waitForSelector('button:has-text("Record audio")');
  await shot(page, `${outDir}/06-capture-audio.png`);

  // 7 — /capture page, video mode.
  await page.locator('label:has-text("Kind") select').selectOption('video');
  await page.waitForSelector('button:has-text("Record video")');
  await shot(page, `${outDir}/07-capture-video.png`);

  // 8 — Tag picker open (grouped event + activity). Click the
  // <select> to open its native dropdown — Playwright can't take a
  // screenshot of an OS-level dropdown, so we capture the select with
  // focus + keyboard focus ring instead.
  await page.locator('label:has-text("Tag") select').focus();
  await shot(page, `${outDir}/08-capture-tag-focus.png`);

  await context.close();

  // 9 — AF view: village picker is an actual choice, not a single
  // locked value. Same screen, different role → different behaviour.
  const { context: afCtx, page: afPage } = await freshContext(browser, DESKTOP);
  await loginAs(afPage, 'af-bid01');
  await afPage.goto(BASE + '/capture');
  await afPage.waitForSelector('h1:has-text("Capture")');
  await shot(afPage, `${outDir}/09-capture-af-village-picker.png`);
  await afCtx.close();
}

async function captureHindi(browser) {
  const outDir = `${OUT}/i18n`;
  await ensure(outDir);
  const { context, page } = await freshContext(browser, DESKTOP, { lang: 'hi' });
  await loginAs(page, 'vc-anandpur');

  // Hindi — /capture page.
  await page.goto(BASE + '/capture');
  await page.waitForSelector('h1:has-text("कैप्चर")');
  await shot(page, `${outDir}/hi-capture.png`);

  // Hindi — village media tab.
  await page.goto(BASE + '/village/1');
  await page.click('button:has-text("मीडिया")');
  await page.waitForSelector('li img, p:has-text("अभी तक कोई मीडिया नहीं")');
  await shot(page, `${outDir}/hi-village-media.png`);

  await context.close();
}

async function main() {
  const fixtures = await writeFixtures();
  const browser = await chromium.launch({ headless: true });
  try {
    console.log('desktop');
    await captureEnglishDesktop(browser, fixtures);
    console.log('i18n');
    await captureHindi(browser);
    console.log('\ndone');
  } finally {
    await browser.close();
    await rm(FIXTURE_DIR, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
