#!/usr/bin/env node
// Loopback OAuth-style CLI sign-in for NavSahyog ERP. Mirrors the
// `gh auth login` / `wrangler login` UX: the operator runs this once,
// a browser tab opens to NavSahyog's web app, they sign in via Clerk,
// and a session cookie lands in `~/.nsf/credentials`. Every subsequent
// curl (or skill invocation) reuses that cookie until it expires.
//
// Why this exists: Clerk is frontend-first — `getToken()` only works
// in a browser. So we run the browser bit ourselves: spin up a one-shot
// loopback listener, open `<web>/cli-auth?return_to=<loopback>&state=…`,
// receive the freshly-minted Clerk JWT on the loopback callback, then
// post it to the Worker's `/auth/exchange` to get back the long-lived
// `nsf_session` cookie. Layers 2-4 of D36 are unchanged.
//
// Usage:
//   node scripts/nsf-auth.mjs                # local dev (defaults below)
//   node scripts/nsf-auth.mjs \
//     --web=https://navsahyog.example \
//     --api=https://navsahyog-api-staging.sameersegal.workers.dev \
//     --basic-auth=user:pass                  # staging outer gate
//
// Env-var equivalents (CLI flags win):
//   NSF_WEB_BASE_URL, NSF_API_BASE_URL, NSF_BASIC, NSF_CREDENTIALS_PATH

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, chmod, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir, platform, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const DEFAULTS = {
  web: 'http://localhost:5173',
  api: 'http://127.0.0.1:8787',
  credentialsPath: `${homedir()}/.nsf/credentials`,
};

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    out[m[1]] = m[2] ?? 'true';
  }
  return out;
}

function fail(msg, code = 1) {
  console.error(`nsf-auth: ${msg}`);
  process.exit(code);
}

function openBrowser(url) {
  const cmd =
    platform() === 'darwin'
      ? ['open', [url]]
      : platform() === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // Fall through — the URL is also printed below so the operator
    // can copy it manually.
  }
}

async function startLoopback(state) {
  let resolveWait;
  let rejectWait;
  const wait = new Promise((res, rej) => {
    resolveWait = res;
    rejectWait = rej;
  });

  const server = createServer((req, response) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      response.writeHead(404).end();
      return;
    }
    const fail = (status, message, err) => {
      response
        .writeHead(status, { 'Content-Type': 'text/html' })
        .end(htmlPage('Sign-in failed', message));
      response.on('finish', () => {
        clearTimeout(timer);
        server.close();
        rejectWait(err);
      });
    };
    const error = url.searchParams.get('error');
    if (error) {
      return fail(400, `Error: ${escapeHtml(error)}.`, new Error(`web returned error: ${error}`));
    }
    const gotState = url.searchParams.get('state') ?? '';
    if (gotState !== state) {
      return fail(400, 'State mismatch — refusing callback.', new Error('state mismatch — refusing callback'));
    }
    const jwt = url.searchParams.get('clerk_jwt') ?? '';
    if (!jwt) {
      return fail(400, 'No token in callback.', new Error('callback had no clerk_jwt'));
    }
    response
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end(htmlPage('Signed in', 'You can close this tab and return to your terminal.'));
    response.on('finish', () => {
      clearTimeout(timer);
      server.close();
      resolveWait(jwt);
    });
  });

  let timer;
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => res());
  });
  timer = setTimeout(
    () => {
      server.close();
      rejectWait(new Error('timed out waiting for browser callback (5 min)'));
    },
    5 * 60 * 1000,
  );
  const { port } = server.address();
  return { port, wait };
}

function htmlPage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111}h1{font-size:1.25rem}p{color:#555}</style></head><body><h1>${escapeHtml(title)}</h1><p>${body}</p></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function parseSetCookie(headers, name) {
  // node 18+ exposes Set-Cookie as an array via getSetCookie() or as a
  // single comma-joined string via .get(). Prefer getSetCookie when
  // present; fall back to splitting on the cookie-attribute boundary.
  let cookies;
  if (typeof headers.getSetCookie === 'function') {
    cookies = headers.getSetCookie();
  } else {
    const raw = headers.get('set-cookie');
    cookies = raw ? [raw] : [];
  }
  for (const line of cookies) {
    const first = line.split(';')[0];
    const eq = first.indexOf('=');
    if (eq < 0) continue;
    const k = first.slice(0, eq).trim();
    const v = first.slice(eq + 1).trim();
    if (k === name) return v;
  }
  return null;
}

function shellQuote(s) {
  // POSIX-safe single-quote quoting: wrap in single quotes, escape any
  // embedded single quotes by closing, escaping with backslash, reopening.
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

async function emitEnv(credentialsPath) {
  let raw;
  try {
    raw = await readFile(credentialsPath, 'utf8');
  } catch {
    fail(
      `${credentialsPath} not found — run 'node scripts/nsf-auth.mjs' first`,
    );
  }
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    fail(`${credentialsPath} is not valid JSON — re-run 'node scripts/nsf-auth.mjs'`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (creds.expires_at && creds.expires_at <= now) {
    fail(`session in ${credentialsPath} has expired — re-run 'node scripts/nsf-auth.mjs'`);
  }
  const host = new URL(creds.api_base_url).hostname;
  const jar = `${tmpdir()}/nsf-cookies-${process.getuid?.() ?? 'u'}.txt`;
  // Netscape cookie jar format. Curl reads this with -b.
  const jarBody =
    '# Netscape HTTP Cookie File\n' +
    `${host}\tFALSE\t/\tFALSE\t0\tnsf_session\t${creds.cookie}\n`;
  await writeFile(jar, jarBody);
  await chmod(jar, 0o600);
  process.stdout.write(
    `export NSF_API_BASE_URL=${shellQuote(creds.api_base_url)}\n`,
  );
  process.stdout.write(`export NSF_COOKIE_JAR=${shellQuote(jar)}\n`);
  if (creds.basic_auth) {
    process.stdout.write(`export NSF_BASIC=${shellQuote(creds.basic_auth)}\n`);
  } else {
    process.stdout.write('unset NSF_BASIC\n');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const credentialsPath =
    args.out ?? process.env.NSF_CREDENTIALS_PATH ?? DEFAULTS.credentialsPath;
  if (args.env === 'true') {
    await emitEnv(credentialsPath);
    return;
  }
  const webBase = (args.web ?? process.env.NSF_WEB_BASE_URL ?? DEFAULTS.web).replace(
    /\/$/,
    '',
  );
  const apiBase = (args.api ?? process.env.NSF_API_BASE_URL ?? DEFAULTS.api).replace(
    /\/$/,
    '',
  );
  const basic = args['basic-auth'] ?? process.env.NSF_BASIC ?? '';

  const state = randomBytes(16).toString('hex');
  const { port, wait } = await startLoopback(state);
  const callback = `http://127.0.0.1:${port}/callback`;
  const browserUrl = new URL(`${webBase}/cli-auth`);
  browserUrl.searchParams.set('return_to', callback);
  browserUrl.searchParams.set('state', state);

  console.log('nsf-auth: opening browser for sign-in…');
  console.log(`  if it doesn't open, visit: ${browserUrl.toString()}`);
  openBrowser(browserUrl.toString());

  const clerkJwt = await wait;
  console.log('nsf-auth: got Clerk token, exchanging for session cookie…');

  const headers = { 'Content-Type': 'application/json' };
  if (basic) headers['Authorization'] = `Basic ${Buffer.from(basic).toString('base64')}`;
  const res = await fetch(`${apiBase}/auth/exchange`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: clerkJwt }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    fail(`/auth/exchange returned ${res.status}: ${body.slice(0, 300)}`);
  }
  const cookieValue = parseSetCookie(res.headers, 'nsf_session');
  if (!cookieValue) fail('/auth/exchange did not set nsf_session');
  const json = await res.json().catch(() => ({}));
  const user = json.user ?? {};

  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const credentials = {
    api_base_url: apiBase,
    web_base_url: webBase,
    cookie: cookieValue,
    basic_auth: basic || null,
    user_id: user.user_id ?? null,
    role: user.role ?? null,
    expires_at: expiresAt,
    saved_at: Math.floor(Date.now() / 1000),
  };
  await mkdir(dirname(credentialsPath), { recursive: true });
  await writeFile(credentialsPath, JSON.stringify(credentials, null, 2) + '\n');
  await chmod(credentialsPath, 0o600);

  console.log(
    `nsf-auth: signed in as ${user.user_id ?? '(unknown)'} (${user.role ?? '?'})`,
  );
  console.log(`nsf-auth: credentials written to ${credentialsPath}`);
  console.log(
    'nsf-auth: load env for curl/skills:  eval "$(node scripts/nsf-auth.mjs --env)"',
  );
}

main().catch((e) => fail(e.message ?? String(e)));
