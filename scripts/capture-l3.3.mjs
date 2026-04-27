#!/usr/bin/env node
// L3.3 Jal Vriddhi pond + agreement form screenshot harness. Drives
// a headless chromium against the local dev stack and captures the
// new pond surfaces for the PR body.
//
// Prereqs (run once before invoking this script):
//   pnpm --filter @navsahyog/web build     # wrangler [assets] needs dist
//   pnpm --filter @navsahyog/api db:reset  # picks up 0009 migration + seed
//   pnpm --filter @navsahyog/api dev &     # 8787, serves dist + /api
//
// Then:
//   node scripts/capture-l3.3.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l3.3');
const BASE = 'http://localhost:8787';

const DESKTOP = { width: 1280, height: 900 };

// Minimal valid PDF — enough for the upload + commit round-trip.
// Re-used twice in the harness so the v2 file is bytes-different
// (extra trailing newline) to avoid the uuid replay guard.
const PDF_V1 = Buffer.from(
  '%PDF-1.4\n1 0 obj <<>> endobj\nxref\n0 1\n0000000000 65535 f \ntrailer <</Size 1>>\nstartxref\n0\n%%EOF\n',
  'utf-8',
);
const PDF_V2 = Buffer.from(
  '%PDF-1.4\n1 0 obj <<>> endobj\nxref\n0 1\n0000000000 65535 f \ntrailer <</Size 1>>\nstartxref\n1\n%%EOF\nrev2\n',
  'utf-8',
);

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

async function shot(page, path) {
  await page.waitForTimeout(300);
  await page.screenshot({ path, fullPage: false });
  console.log('  →', path.replace(ROOT + '/', ''));
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

async function main() {
  await ensure(OUT);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // ---- Frame 1: empty pond list (VC, before any ponds) ----------
  await loginAs(page, 'vc-anandpur');
  await page.goto(BASE + '/ponds');
  await page.waitForLoadState('networkidle');
  await shot(page, `${OUT}/01-list-empty.png`);

  // ---- Frame 2: blank create form ------------------------------
  await page.click('a:has-text("Add pond")');
  await page.waitForURL('**/ponds/new');
  await page.waitForSelector('h1:has-text("New pond")');
  await shot(page, `${OUT}/02-form-blank.png`);

  // ---- Frame 3: filled create form -----------------------------
  await page.fill('input[required][maxlength="120"]', 'Ramesh Kumar');
  await page.fill('input[type="tel"]', '+919876543210');
  // Plot identifier (second 120-char text input).
  await page.fill('input[placeholder^="e.g. Survey"]', 'Survey No. 42/3');
  // GPS (manual entry — geolocation prompt would block in headless).
  await page.fill('input[placeholder="12.971599"]', '12.971599');
  await page.fill('input[placeholder="77.594566"]', '77.594566');
  await page.fill('textarea', 'On the south edge of the plot, near the bund.');
  await page.fill(
    'input[placeholder*="Renewal"]',
    'Initial signing — March 2026.',
  );
  // Agreement file picker.
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'jal-vriddhi-agreement-ramesh.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_V1,
    });
  await shot(page, `${OUT}/03-form-filled.png`);

  // ---- Frame 4: detail page after first save (v1) ---------------
  await Promise.all([
    page.waitForURL(/\/ponds\/\d+$/),
    page.click('button:has-text("Save pond")'),
  ]);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('h1:has-text("Ramesh Kumar")');
  await shot(page, `${OUT}/04-detail-v1.png`);

  // ---- Frame 5: re-upload form open with note ------------------
  await page
    .locator('section:has-text("Upload a new version") input[type="file"]')
    .setInputFiles({
      name: 'jal-vriddhi-agreement-ramesh-renewal-2027.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_V2,
    });
  await page.fill(
    'section:has-text("Upload a new version") input[placeholder*="Renewal"]',
    'Renewal for FY 2027. Updated bund clause.',
  );
  await shot(page, `${OUT}/05-reupload-staged.png`);

  // ---- Frame 6: detail page after re-upload (v2 + v1) ----------
  await Promise.all([
    page.waitForResponse((r) =>
      r.url().includes('/agreements') && r.request().method() === 'POST'),
    page.click('button:has-text("Save as v2")'),
  ]);
  await page.waitForLoadState('networkidle');
  // Wait for the version count to update — "2 versions on file".
  await page.waitForSelector('text=2 versions on file');
  await shot(page, `${OUT}/06-detail-v2-history.png`);

  // ---- Frame 7: list with a pond + version count --------------
  await page.click('a:has-text("Back to all ponds")');
  await page.waitForURL('**/ponds');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('text=Ramesh Kumar');
  await shot(page, `${OUT}/07-list-with-pond.png`);

  // ---- Frame 8: District admin — read-only list, no Add CTA ----
  await context.clearCookies();
  await loginAs(page, 'district-bid');
  await page.goto(BASE + '/ponds');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('text=Ramesh Kumar');
  await shot(page, `${OUT}/08-list-district-readonly.png`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
