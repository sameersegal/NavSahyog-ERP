#!/usr/bin/env node
// Generate requirements/generated/endpoints.md from the route
// files in apps/api/src/routes/.
//
// Source of truth:
//   - per-file `export const meta: RouteMeta` (context, cra, offline, refs)
//   - per-handler: HTTP method, path, requireCap('…') argument,
//     presence of withIdempotency in the handler body
//   - capability → roles inverse from
//     packages/shared/src/capabilities.ts (CAPABILITIES_BY_ROLE)
//
// Modes:
//   node scripts/gen-matrix.mjs            # write endpoints.md
//   node scripts/gen-matrix.mjs --check    # exit non-zero if stale
//
// No new deps — uses the bundled `typescript` compiler API.

import ts from 'typescript';
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const routesDir = join(repoRoot, 'apps/api/src/routes');
const capsFile = join(repoRoot, 'packages/shared/src/capabilities.ts');
const outDir = join(repoRoot, 'requirements/generated');
const outFile = join(outDir, 'endpoints.md');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const CONTEXT_ORDER = [
  'identity',
  'masters',
  'beneficiaries',
  'programs',
  'media',
  'dashboard',
  'sync',
];

// --- AST helpers ---

function parseFile(file) {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  );
}

// Strip `as const`, `satisfies T`, and parens.
function unwrap(node) {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node))
  ) {
    node = node.expression;
  }
  return node;
}

function isStringLike(node) {
  return (
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
  );
}

function containsIdent(root, name) {
  let found = false;
  (function walk(n) {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  })(root);
  return found;
}

// --- Capability matrix from packages/shared/src/capabilities.ts ---

function resolveCapabilities() {
  const sf = parseFile(capsFile);
  const arrays = new Map(); // name -> string[]
  const byRole = {};

  function resolveArray(arr) {
    const out = [];
    for (const el of arr.elements) {
      if (isStringLike(el)) {
        out.push(el.text);
      } else if (ts.isSpreadElement(el)) {
        const inner = unwrap(el.expression);
        if (ts.isIdentifier(inner)) {
          const ref = arrays.get(inner.text);
          if (ref) out.push(...ref);
        } else if (ts.isArrayLiteralExpression(inner)) {
          out.push(...resolveArray(inner));
        }
      }
    }
    return out;
  }

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const name = decl.name.text;
      const init = unwrap(decl.initializer);
      if (ts.isArrayLiteralExpression(init)) {
        arrays.set(name, resolveArray(init));
      } else if (
        ts.isObjectLiteralExpression(init) &&
        name === 'CAPABILITIES_BY_ROLE'
      ) {
        for (const prop of init.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const role = ts.isIdentifier(prop.name)
            ? prop.name.text
            : ts.isStringLiteral(prop.name)
              ? prop.name.text
              : null;
          if (!role) continue;
          const val = unwrap(prop.initializer);
          if (ts.isArrayLiteralExpression(val)) {
            byRole[role] = resolveArray(val);
          } else if (ts.isIdentifier(val)) {
            byRole[role] = arrays.get(val.text) ?? [];
          }
        }
      }
    }
  }
  return byRole;
}

// --- Per-route extraction ---

function parseObjectLiteral(node) {
  if (!ts.isObjectLiteralExpression(node)) return null;
  const out = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : null;
    if (!key) continue;
    out[key] = parseValue(unwrap(prop.initializer));
  }
  return out;
}

function parseValue(node) {
  if (!node) return null;
  if (isStringLike(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((e) => parseValue(unwrap(e)));
  }
  if (ts.isObjectLiteralExpression(node)) return parseObjectLiteral(node);
  return null;
}

// Find the local variable that holds `new Hono<...>()`. We only
// match handler registrations on that name — otherwise things
// like `c.get('user')` and `headers.get('content-type')` get
// mis-classified as routes.
function findRouterName(sf) {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const init = decl.initializer;
      if (
        ts.isNewExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === 'Hono'
      ) {
        return decl.name.text;
      }
    }
  }
  return null;
}

function extractRouteFile(file) {
  const sf = parseFile(file);
  let meta = null;
  const handlers = [];
  const routerName = findRouterName(sf);

  for (const stmt of sf.statements) {
    if (
      ts.isVariableStatement(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === 'meta' &&
          decl.initializer
        ) {
          meta = parseObjectLiteral(unwrap(decl.initializer));
        }
      }
    }
  }

  if (!routerName) return { meta, handlers };

  (function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === routerName &&
      ts.isIdentifier(node.expression.name)
    ) {
      const method = node.expression.name.text.toLowerCase();
      if (HTTP_METHODS.has(method)) {
        const args = node.arguments;
        if (args.length >= 1 && isStringLike(args[0])) {
          const path = args[0].text;
          let cap = null;
          let idempotent = false;
          for (const a of args.slice(1)) {
            if (
              ts.isCallExpression(a) &&
              ts.isIdentifier(a.expression) &&
              a.expression.text === 'requireCap'
            ) {
              const a0 = a.arguments[0];
              if (a0 && isStringLike(a0)) cap = a0.text;
            }
            if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) {
              if (containsIdent(a, 'withIdempotency')) idempotent = true;
            }
          }
          handlers.push({ method: method.toUpperCase(), path, cap, idempotent });
        }
      }
    }
    ts.forEachChild(node, visit);
  })(sf);

  return { meta, handlers };
}

// --- Render ---

function rolesByCap(byRole) {
  const inv = {};
  for (const [role, caps] of Object.entries(byRole)) {
    for (const cap of caps) {
      (inv[cap] ??= []).push(role);
    }
  }
  return inv;
}

function renderMarkdown(routes, byRole) {
  const inv = rolesByCap(byRole);
  const lines = [];
  lines.push('<!-- generated by scripts/gen-matrix.mjs — do not edit -->');
  lines.push('');
  lines.push('# Endpoint Matrix');
  lines.push('');
  lines.push(
    'Source of truth: route files in `apps/api/src/routes/` and `packages/shared/src/capabilities.ts`.',
  );
  lines.push('Run `pnpm matrix` to regenerate.');
  lines.push('');

  const grouped = {};
  for (const r of routes) {
    const c = r.meta?.context ?? '(unannotated)';
    (grouped[c] ??= []).push(r);
  }

  const order = [...CONTEXT_ORDER, '(unannotated)'];
  for (const ctx of order) {
    const list = grouped[ctx];
    if (!list || list.length === 0) continue;
    lines.push(`## ${ctx}`);
    lines.push('');
    for (const r of list) {
      const fileRel = r.file.replace(`${repoRoot}/`, '');
      const m = r.meta;
      const heading = m?.resource ?? r.basename;
      lines.push(`### ${heading} — \`${fileRel}\``);
      lines.push('');
      if (m) {
        const off =
          [
            m.offline?.write ? `write=${m.offline.write}` : null,
            m.offline?.read ? `read=${m.offline.read}` : null,
          ]
            .filter(Boolean)
            .join(', ') || '—';
        const refs =
          Array.isArray(m.refs) && m.refs.length > 0 ? m.refs.join(', ') : '—';
        lines.push(`Refs: ${refs} · CRA: ${m.cra ?? '—'} · Offline: ${off}`);
      } else {
        lines.push('_no `meta` export — annotate this file_');
      }
      lines.push('');
      if (r.handlers.length > 0) {
        lines.push('| Method | Path | Capability | Roles | Idempotent |');
        lines.push('|---|---|---|---|---|');
        for (const h of r.handlers) {
          const roles = h.cap
            ? (inv[h.cap] ?? []).join(', ') || '—'
            : '—';
          const capCell = h.cap ? '`' + h.cap + '`' : 'public';
          const path = h.path || '/';
          lines.push(
            `| ${h.method} | \`${path}\` | ${capCell} | ${roles} | ${h.idempotent ? 'yes' : '—'} |`,
          );
        }
        lines.push('');
      }
    }
  }
  return lines.join('\n') + '\n';
}

// --- Main ---

const byRole = resolveCapabilities();
const routeFiles = readdirSync(routesDir)
  .filter((f) => f.endsWith('.ts'))
  .sort();
const routes = routeFiles.map((f) => {
  const file = join(routesDir, f);
  const { meta, handlers } = extractRouteFile(file);
  return { file, basename: f.replace(/\.ts$/, ''), meta, handlers };
});

const md = renderMarkdown(routes, byRole);

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

if (process.argv.includes('--check')) {
  const existing = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
  if (existing !== md) {
    console.error(
      'gen-matrix: requirements/generated/endpoints.md is out of date — run `pnpm matrix`',
    );
    process.exit(1);
  }
  console.log('gen-matrix: endpoints.md up to date');
} else {
  writeFileSync(outFile, md);
  const annotated = routes.filter((r) => r.meta).length;
  console.log(
    `gen-matrix: wrote ${outFile} (${routes.length} route files, ${annotated} annotated)`,
  );
}
