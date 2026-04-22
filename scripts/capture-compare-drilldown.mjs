#!/usr/bin/env node
// Frame-by-frame walkthrough of the Home (/) drill-down surface
// — the compare + navigate table at each level of the hierarchy.
// Every tile row carries the same KPI set the scope strip shows
// (children, attendance %, images, videos, achievements, activity
// chip) so sibling subtrees read at a glance; rows are click-to-
// drill, so compare and navigation are the same affordance.
//
// Covers: super admin, drilling
//   India → Zone → State → Region → District → Cluster.
//
// Outputs PNGs under mvp/screenshots/compare-drilldown/ numbered
// so `ls` gives them in walkthrough order.
//
// Prereqs: `pnpm db:reset`, then both dev servers up:
//   pnpm --filter @navsahyog/api dev
//   pnpm --filter @navsahyog/web dev
//
// Run:  node scripts/capture-compare-drilldown.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = 'http://localhost:5173';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const OUT = resolve(ROOT, 'mvp/screenshots/compare-drilldown');

// Every level in the hierarchy we walk through. Ids are the seed's
// KA branch — South Zone (1), Karnataka (1), KA region (1), Bidar
// (1), Bidar Cluster 1 (1) — chosen because it's the only sub-tree
// dense enough to populate every level with > 1 child.
const FRAMES = [
  { name: '01-india',    url: '/' },
  { name: '02-zone',     url: '/?level=zone&id=1' },
  { name: '03-state',    url: '/?level=state&id=1' },
  { name: '04-region',   url: '/?level=region&id=1' },
  { name: '05-district', url: '/?level=district&id=1' },
  { name: '06-cluster',  url: '/?level=cluster&id=1' },
];

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

async function shot(page, dir, name) {
  await page.waitForTimeout(400);
  const path = `${dir}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log('  →', path.replace(ROOT + '/', ''));
}

async function capture(browser, viewport, subdir) {
  const dir = `${OUT}/${subdir}`;
  await mkdir(dir, { recursive: true });
  const { context, page } = await freshContext(browser, viewport);
  await loginAs(page, 'super');
  for (const f of FRAMES) {
    await page.goto(BASE + f.url);
    await page.waitForLoadState('networkidle');
    await shot(page, dir, f.name);
  }
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    await capture(browser, DESKTOP, 'desktop');
    await capture(browser, MOBILE, 'mobile');
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
