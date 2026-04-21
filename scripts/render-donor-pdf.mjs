#!/usr/bin/env node
/*
  Render a donor-update 1-pager from a JSON data file + the template
  in mvp/donor-pdf/. Produces a PDF and a PNG preview.

  Usage:
    node scripts/render-donor-pdf.mjs <data.json> [--out=<dir>]

  The data file shape matches mvp/donor-pdf/examples/belur-q1-2026.json.
  The skill (.claude/skills/donor-update/SKILL.md) produces and refines
  these JSON files; this script only renders.

  Kept deliberately small:
    - No template engine dependency. Mustache-style {{path}} and
      {{#each arr}}...{{/each}} / {{#if key}}...{{/if}} cover every
      construct the template uses.
    - Playwright is the only external requirement; it's already in the
      root devDependencies. On first run: `pnpm exec playwright install chromium`.
*/

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const templateDir = path.join(repoRoot, 'mvp', 'donor-pdf');

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args.flags[k] = v ?? true;
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

// Look up a dotted path on the data object. Returns undefined if any
// hop misses so the caller can fall back to the empty string.
function lookup(data, dotted) {
  return dotted.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), data);
}

// Expand {{#each arr}}...{{/each}} blocks. The inner body sees each
// item's keys as top-level {{keys}}. One-level only — donor PDFs
// don't need nested iteration.
function expandEach(tmpl, data) {
  return tmpl.replace(
    /\{\{#each ([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, key, body) => {
      const arr = lookup(data, key);
      if (!Array.isArray(arr)) return '';
      return arr.map((item) => expandSimple(body, item)).join('');
    },
  );
}

// Expand {{#if key}}...{{/if}}. Truthy check; no else branch (not
// needed yet).
function expandIf(tmpl, data) {
  return tmpl.replace(
    /\{\{#if ([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, body) => {
      const v = lookup(data, key);
      return v ? body : '';
    },
  );
}

// Simple {{path}} substitution. Missing paths render as empty string
// (safer than leaving the marker visible in the PDF).
function expandSimple(tmpl, data) {
  return tmpl.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const v = lookup(data, key);
    return v == null ? '' : String(v);
  });
}

function render(tmpl, data) {
  // Order matters: resolve nested control flow first, then simple
  // substitutions. Each pass is stable because the expanders match
  // tags that can't be introduced by later substitution output.
  let out = expandEach(tmpl, data);
  out = expandIf(out, data);
  out = expandSimple(out, data);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const dataPath = args.positional[0];
  if (!dataPath) {
    console.error('Usage: render-donor-pdf.mjs <data.json> [--out=<dir>]');
    process.exit(1);
  }
  const dataAbs = path.resolve(dataPath);
  const data = JSON.parse(await fs.readFile(dataAbs, 'utf8'));

  // Default output lives alongside the data file so examples/foo.json
  // yields examples/foo.pdf + examples/foo.preview.png.
  const outDir = args.flags.out ? path.resolve(args.flags.out) : path.dirname(dataAbs);
  await fs.mkdir(outDir, { recursive: true });
  const stem = path.basename(dataAbs, path.extname(dataAbs));
  // --theme suffix keeps multi-theme renders of the same data file
  // from clobbering each other.
  const themeSuffix = args.flags.theme ? `.${args.flags.theme}` : '';
  const pdfPath = path.join(outDir, `${stem}${themeSuffix}.pdf`);
  const previewPath = path.join(outDir, `${stem}${themeSuffix}.preview.png`);

  // Defaults that the template relies on; keep local so examples can
  // omit them. --theme on the command line overrides whatever the
  // JSON says, so the same data can be re-rendered in each theme.
  const merged = {
    lang: 'en',
    theme: 'quarterly',
    ...data,
    footer: {
      tagline: 'Thank you for walking with us.',
      org_url: 'navsahyog.org',
      contact: 'info@navsahyog.org',
      ...(data.footer ?? {}),
    },
  };
  if (args.flags.theme) merged.theme = args.flags.theme;

  // Resolve media URLs relative to the *data file's* directory and
  // rewrite them as `file://` absolute URLs. This way a JSON sitting
  // at examples/foo/foo.json can say `media/bar.jpg` to mean
  // examples/foo/media/bar.jpg, and the rendered HTML (written into
  // mvp/donor-pdf/.render.html) still resolves it correctly.
  // Absolute URLs (http/https/file, or starting with `/`) pass through.
  if (Array.isArray(merged.media)) {
    const dataDir = path.dirname(dataAbs);
    merged.media = merged.media.map((item) => {
      const u = item?.url;
      if (!u) return item;
      if (/^(https?:|file:)/.test(u) || u.startsWith('/')) return item;
      const abs = path.resolve(dataDir, u);
      return { ...item, url: 'file://' + abs };
    });
  }

  const tmpl = await fs.readFile(path.join(templateDir, 'template.html'), 'utf8');
  const html = render(tmpl, merged);

  // We render the template from its own directory so relative asset
  // paths (styles.css, themes/*.css, assets/*.svg, media/*.jpg)
  // resolve without surgery. Write the rendered HTML into a sibling
  // render.html and clean it up on success. Leaving it on failure
  // makes debugging the output trivial — just open it in a browser.
  const renderHtml = path.join(templateDir, '.render.html');
  await fs.writeFile(renderHtml, html);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + renderHtml, { waitUntil: 'networkidle' });
    // Set the viewport to the A4 pixel-equivalent so the PNG preview
    // matches what the PDF will render. 96 DPI × 210mm/25.4 ≈ 794px.
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    await page.screenshot({ path: previewPath, fullPage: true });
  } finally {
    await browser.close();
    if (!args.flags['keep-html']) {
      await fs.unlink(renderHtml).catch(() => {});
    } else {
      console.log(`HTML     → ${path.relative(process.cwd(), renderHtml)}`);
    }
  }

  console.log(`PDF      → ${path.relative(process.cwd(), pdfPath)}`);
  console.log(`Preview  → ${path.relative(process.cwd(), previewPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
