// Shell service worker — caches the static app shell for offline +
// iOS PWA support (decisions.md D34, overruling L4.0c's "no SW" stance
// for the shell-only case).
//
// Scope: HTML, JS, CSS, images, the manifest. The cache key embeds
// APP_BUILD (passed as `?v=...` on registration) so a deploy always
// installs as a new SW and the activate step purges old-build caches.
// That keeps storage bounded and aligns with the N-7 client compat
// window in D31.
//
// Out of scope: every data endpoint (`/api/*`, `/auth/*`, `/health`)
// passes straight through to the network. The platform's offline-
// scope contract (requirements/offline-scope.md) and the spec'd
// "data unavailable" UX rely on those failures propagating to the
// app, not being papered over with stale cached responses.

const params = new URL(self.location.href).searchParams;
const BUILD = params.get('v') || 'dev';
const CACHE = `nsf-shell-${BUILD}`;

// Bootstrap entries — everything else fills in lazily on first online
// navigation. Hashed Vite assets (`/assets/*-<hash>.js`) get cached
// by the runtime fetch handler the first time the page requests them.
const PRECACHE = ['/', '/index.html', '/logo.png', '/manifest.webmanifest'];

function isDataPath(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname === '/health'
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('nsf-shell-') && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (isDataPath(url)) return;

  // Navigation (HTML): network-first so deploys land immediately when
  // online; fall back to the cached SPA shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const clone = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put('/index.html', clone))
            .catch(() => {});
          return res;
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match('/index.html')) ||
            (await cache.match('/')) ||
            new Response('Offline', { status: 503, statusText: 'Offline' })
          );
        }
      })(),
    );
    return;
  }

  // Hashed assets / other static GETs: cache-first with lazy refill.
  // Vite emits content-hashed filenames so a cache hit is always for
  // the right bytes; on miss we go to network and fill the cache.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })(),
  );
});

// Lets the page request an immediate SW swap on user-driven refresh.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
