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
          bindings: {
            ENVIRONMENT: 'test',
            ALLOWED_ORIGINS: 'http://localhost:5173',
          },
        },
      },
    },
  },
});
