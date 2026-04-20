// Type augmentations for the vitest-pool-workers runtime and our
// Vite-style `?raw` SQL imports. These declarations are what `tsc
// --noEmit` needs; they don't ship to the bundle.

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    ENVIRONMENT: string;
    ALLOWED_ORIGINS: string;
  }
}

declare module '*.sql?raw' {
  const content: string;
  export default content;
}
