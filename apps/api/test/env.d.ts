// Type augmentations for the vitest-pool-workers runtime and our
// Vite-style `?raw` SQL imports. These declarations are what `tsc
// --noEmit` needs; they don't ship to the bundle.

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    MEDIA: R2Bucket;
    ENVIRONMENT: string;
    ALLOWED_ORIGINS: string;
    MEDIA_PRESIGN_SECRET: string;
  }
}

declare module '*.sql?raw' {
  const content: string;
  export default content;
}

// Minimal shape of Vite's `import.meta.glob`. We use only the eager,
// default-import variant with a `?raw` query to pull in every
// migration file in sort order. Full Vite client typings would add a
// direct dep on `vite` that we don't otherwise need in apps/api.
interface ImportMeta {
  glob: <T = unknown>(
    pattern: string,
    options?: {
      query?: string;
      import?: string;
      eager?: boolean;
    },
  ) => Record<string, T>;
}
