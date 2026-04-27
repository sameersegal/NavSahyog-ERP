import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build identifier for the L4.0a compat header (decisions.md D31).
// CI sets APP_BUILD to `YYYY-MM-DD.<short-sha>`; local builds fall
// back to today's UTC date with a `.dev` suffix. Format must match
// packages/shared/src/sync.ts BUILD_ID_RE.
const buildId =
  process.env.APP_BUILD ?? `${new Date().toISOString().slice(0, 10)}.dev`;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD__: JSON.stringify(buildId),
  },
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:8787',
      '/api': 'http://localhost:8787',
    },
  },
});
