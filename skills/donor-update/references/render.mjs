#!/usr/bin/env node
/*
  Render a donor-update 1-pager from a JSON data file + one of the
  theme templates that ship with this skill. Produces a PDF and a
  PNG preview.

  Usage:
    node skills/donor-update/references/render.mjs \
      <data.json> [--theme=<name>] [--out=<dir>] [--keep-html]

  The theme (`quarterly` | `milestone` | `celebration`) determines
  which template in themes/<name>.html renders. `--theme` on the
  command line overrides the JSON's `theme` field. Each template
  expects its own data shape — see the matching example JSON in
  examples/.

  Templating is Handlebars — `{{path}}`, `{{{path}}}` (raw),
  `{{#if key}}...{{/if}}`, `{{#each arr}}...{{/each}}`, plus all the
  usual niceties. Playwright is the only other external dep; both
  are devDependencies at the repo root. On first run:
  `pnpm exec playwright install chromium`.
*/

import Handlebars from 'handlebars';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Template and assets sit alongside this script inside references/.
const templateDir = __dirname;

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

// Walk the data tree and absolutise any `url` property on an object.
// Mutates in place. Non-strings, absolute URLs, and empty values are
// left alone. Arrays and nested objects recurse.
function resolveUrls(node, dataDir) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) resolveUrls(item, dataDir);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'url' && typeof v === 'string' && v.length > 0) {
      if (!/^(https?:|file:)/.test(v) && !v.startsWith('/')) {
        node[k] = 'file://' + path.resolve(dataDir, v);
      }
    } else {
      resolveUrls(v, dataDir);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const dataPath = args.positional[0];
  if (!dataPath) {
    console.error('Usage: render.mjs <data.json> [--theme=<name>] [--out=<dir>] [--keep-html]');
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

  // Resolve every `url` key anywhere in the data tree relative to the
  // *data file's* directory and rewrite them as `file://` absolute
  // URLs. Covers media[].url, hero.url, mosaic[].url, and anything
  // future templates introduce without touching the renderer.
  // Absolute URLs (http/https/file, or starting with `/`) pass through.
  const dataDir = path.dirname(dataAbs);
  resolveUrls(merged, dataDir);

  // The theme picks the template file. All three sit in themes/ and
  // link their own CSS (base.css + themes/<name>.css) via relative
  // paths; the renderer is theme-agnostic beyond the filename.
  const tmplPath = path.join(templateDir, 'themes', `${merged.theme}.html`);
  const tmpl = await fs.readFile(tmplPath, 'utf8').catch((e) => {
    if (e.code === 'ENOENT') {
      throw new Error(
        `Unknown theme "${merged.theme}". Expected a template at ${path.relative(process.cwd(), tmplPath)}.`,
      );
    }
    throw e;
  });
  const html = Handlebars.compile(tmpl)(merged);

  // Write the rendered HTML next to its template (inside themes/) so
  // the template's own `<link href="../base.css">` etc. resolve
  // correctly in the browser. Clean up on success; keep on failure
  // so an operator can open .render.html in a browser to debug.
  const renderHtml = path.join(templateDir, 'themes', '.render.html');
  await fs.writeFile(renderHtml, html);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + renderHtml, { waitUntil: 'networkidle' });
    // Set the viewport to the A4 pixel-equivalent so the PNG preview
    // matches what the PDF will render. 96 DPI × 210mm/25.4 ≈ 794px.
    await page.setViewportSize({ width: 794, height: 1123 });
    // `networkidle` has been observed to let the page settle before
    // https: images finish decoding when the page itself is loaded
    // via file:// (the cross-origin fetch timing confuses the idle
    // heuristic). Explicitly block on every <img> completing before
    // we screenshot/PDF, or fail loud if one 404s.
    await page.waitForFunction(
      () =>
        Array.from(document.images).every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      null,
      { timeout: 30_000 },
    );
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
