import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// The workers pool runs tests inside a miniflare-hosted copy of
// the worker, with real D1 / KV bindings. That's how the route
// tests get a real SQL surface without mocking.
//
// The DB is created empty on every test run; tests seed it via
// `test/setup.ts`.
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: './src/index.ts',
        singleWorker: true,
        isolatedStorage: false,
        miniflare: {
          compatibilityDate: '2024-12-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          r2Buckets: ['MEDIA'],
          bindings: {
            ENVIRONMENT: 'test',
            ALLOWED_ORIGINS: 'http://localhost:5173',
            MEDIA_PRESIGN_SECRET: 'test-secret',
            // Build-id middleware (L4.0c). Floor at 2020-01-01 so any
            // realistically-dated test build passes; tests that want
            // to exercise the 426 path use a build older than this.
            MIN_SUPPORTED_BUILD: '2020-01-01.test',
            // Server-build response header — tests assert this stamp.
            SERVER_BUILD_ID: '2026-04-27.test',
          },
        },
      },
    },
  },
});
