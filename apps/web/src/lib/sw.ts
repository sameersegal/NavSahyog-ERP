// Service-worker registration (decisions.md D34).
//
// The SW lives at `/sw.js` (public/) and caches the static app shell
// only; data endpoints pass through. The build id is forwarded as a
// query param so each deploy registers as a distinct SW and the
// activate step purges old-build caches.
//
// Registration is gated on `import.meta.env.PROD` because a SW
// caching the dev server would interfere with HMR. Tests don't run
// this path either (no `serviceWorker` in jsdom).

import { BUILD_ID } from './build';

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  const url = `/sw.js?v=${encodeURIComponent(BUILD_ID)}`;
  // Wait for `load` so the SW install doesn't compete with the
  // initial render for bandwidth.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(url).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[sw] registration failed', err);
    });
  });
}
