#!/usr/bin/env node
// L3.0b §3.6.4 observer Home — captures the observer + doer Home
// after the symmetric Focus Areas redesign. Run with the dev stack
// up (vite on 5173, wrangler on 8787).
//
// Outputs to mvp/screenshots/l3.0b/.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l3.0b');
const BASE = 'http://localhost:5173';

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 900 };

await mkdir(OUT, { recursive: true });

async function login(page, userId) {
  await page.goto(BASE + '/login');
  await page.waitForSelector('input[autocomplete="username"]');
  await page.fill('input[autocomplete="username"]', userId);
  await page.fill('input[autocomplete="current-password"]', 'password');
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login')),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle');
}

async function shoot(page, file) {
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  console.log('  →', file);
}

const browser = await chromium.launch();

const matrix = [
  // Observers — the new shape (multi-KPI Focus Areas + Compare-all link)
  { user: 'district-bid',  who: 'district-admin',  viewport: DESKTOP, label: 'desktop' },
  { user: 'district-bid',  who: 'district-admin',  viewport: MOBILE,  label: 'mobile' },
  { user: 'state-ka',      who: 'state-admin',     viewport: DESKTOP, label: 'desktop' },
  { user: 'state-ka',      who: 'state-admin',     viewport: MOBILE,  label: 'mobile' },
  { user: 'zone-sz',       who: 'zone-admin',      viewport: DESKTOP, label: 'desktop' },
  { user: 'region-sk',     who: 'region-admin',    viewport: MOBILE,  label: 'mobile' },
  // Doers — confirm the new dominant-gap copy + Health Score pill
  { user: 'super',         who: 'super-admin',     viewport: DESKTOP, label: 'desktop' },
  { user: 'super',         who: 'super-admin',     viewport: MOBILE,  label: 'mobile' },
  { user: 'cluster-bid01', who: 'cluster-admin',   viewport: DESKTOP, label: 'desktop' },
];

for (const m of matrix) {
  const ctx = await browser.newContext({ viewport: m.viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  console.log(`> ${m.who} (${m.label})`);
  await login(page, m.user);
  await shoot(page, `home-${m.who}-${m.label}-7d.png`);
  await ctx.close();
}

await browser.close();
console.log('\nDone:', OUT);
