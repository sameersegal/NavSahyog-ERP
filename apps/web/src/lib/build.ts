// Client build identity (L4.0a — decisions.md D31).
//
// `BUILD_ID` is the value the client sends in the `X-App-Build`
// header on every API request. Format: `YYYY-MM-DD[.suffix]` —
// see packages/shared/src/sync.ts for the parser.
//
// In production / CI, `__APP_BUILD__` is replaced at compile time by
// the Vite `define` block in vite.config.ts, which reads
// process.env.APP_BUILD (CI) or falls back to the build-time ISO
// date with a `.dev` suffix. In tests where the define isn't applied
// (jsdom + Vitest using src/main as entry), the typeof check keeps
// us out of a ReferenceError and we synthesise a per-day stamp.

declare const __APP_BUILD__: string | undefined;

function fallbackBuildId(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${today}.dev`;
}

export const BUILD_ID: string =
  typeof __APP_BUILD__ === 'string' && __APP_BUILD__.length > 0
    ? __APP_BUILD__
    : fallbackBuildId();
