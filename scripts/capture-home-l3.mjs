#!/usr/bin/env node
// L3.0 §3.6.4 Field-Dashboard Home — captures the doer + observer
// home variants on desktop and mobile. Run after `pnpm db:reset` and
// with the dev stack up (vite on 5173, wrangler on 8787).
//
// Outputs to mvp/screenshots/l3.0/.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'mvp/screenshots/l3.0');
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
  // Home renders after one /api/dashboard/home fetch; wait for the
  // health-score number (or its em-dash placeholder) before the snap.
  await page.waitForLoadState('networkidle');
}

async function shoot(page, file) {
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  console.log('  →', file);
}

const browser = await chromium.launch();

const matrix = [
  { user: 'super',         who: 'super-admin',     viewport: DESKTOP, label: 'desktop' },
  { user: 'super',         who: 'super-admin',     viewport: MOBILE,  label: 'mobile' },
  { user: 'vc-anandpur',   who: 'vc',              viewport: MOBILE,  label: 'mobile' },
  { user: 'cluster-bid01', who: 'cluster-admin',   viewport: DESKTOP, label: 'desktop' },
  { user: 'district-bid',  who: 'district-admin',  viewport: DESKTOP, label: 'desktop' },
  { user: 'state-ka',      who: 'state-admin',     viewport: MOBILE,  label: 'mobile' },
];

for (const m of matrix) {
  const ctx = await browser.newContext({ viewport: m.viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  console.log(`> ${m.who} (${m.label})`);
  await login(page, m.user);
  await shoot(page, `home-${m.who}-${m.label}-7d.png`);
  // 30D preset to confirm one fetch / consistent refresh.
  await page.click('button[role="radio"]:has-text("30D")');
  await page.waitForLoadState('networkidle');
  await shoot(page, `home-${m.who}-${m.label}-30d.png`);
  await ctx.close();
}

await browser.close();
console.log('\nDone:', OUT);
