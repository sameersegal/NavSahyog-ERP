// L4.0a — Build-id compat (decisions.md D29, D31).
//
// Pure-helper tests for shared/src/sync.ts plus an integration test
// for apps/api/src/lib/build.ts middleware behaviour against the
// running Worker.

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  BUILD_ID_HEADER,
  checkCompat,
  daysBetweenIso,
  dominantState,
  parseBuildDate,
  todayIso,
} from '@navsahyog/shared';

describe('parseBuildDate', () => {
  it('extracts the date prefix when the build id matches the format', () => {
    expect(parseBuildDate('2026-04-27')).toBe('2026-04-27');
    expect(parseBuildDate('2026-04-27.abc1234')).toBe('2026-04-27');
    expect(parseBuildDate('2026-04-27.dev')).toBe('2026-04-27');
  });

  it('returns null for malformed or missing input', () => {
    expect(parseBuildDate(null)).toBeNull();
    expect(parseBuildDate(undefined)).toBeNull();
    expect(parseBuildDate('')).toBeNull();
    expect(parseBuildDate('abc')).toBeNull();
    expect(parseBuildDate('2026-4-27')).toBeNull(); // missing zero-pad
    expect(parseBuildDate('2026-04-27.has space')).toBeNull();
  });
});

describe('daysBetweenIso', () => {
  it('returns the signed day delta for valid ISO dates', () => {
    expect(daysBetweenIso('2026-04-20', '2026-04-27')).toBe(7);
    expect(daysBetweenIso('2026-04-27', '2026-04-20')).toBe(-7);
    expect(daysBetweenIso('2026-04-27', '2026-04-27')).toBe(0);
  });

  it('returns null when either date is unparseable', () => {
    expect(daysBetweenIso('garbage', '2026-04-27')).toBeNull();
    expect(daysBetweenIso('2026-04-27', 'garbage')).toBeNull();
  });
});

describe('checkCompat', () => {
  const today = '2026-04-27';

  it('accepts builds within the 7-day window', () => {
    expect(checkCompat('2026-04-27', today).kind).toBe('ok');
    expect(checkCompat('2026-04-21', today).kind).toBe('ok');
    expect(checkCompat('2026-04-20', today).kind).toBe('ok'); // exactly 7d
  });

  it('rejects builds older than 7 days', () => {
    const v = checkCompat('2026-04-19', today);
    expect(v.kind).toBe('too_old');
    if (v.kind === 'too_old') expect(v.days).toBe(8);
  });

  it('treats future-dated builds as ok (clock skew is the server\'s problem)', () => {
    expect(checkCompat('2026-05-10', today).kind).toBe('ok');
  });

  it('returns unknown_build for missing or malformed headers', () => {
    expect(checkCompat(null, today).kind).toBe('unknown_build');
    expect(checkCompat('not-a-build', today).kind).toBe('unknown_build');
  });

  it('honours a custom window override', () => {
    expect(checkCompat('2026-04-25', today, 1).kind).toBe('too_old');
    expect(checkCompat('2026-04-26', today, 1).kind).toBe('ok');
  });
});

describe('dominantState', () => {
  it('picks the worst state across the inputs', () => {
    expect(dominantState(['green', 'green'])).toBe('green');
    expect(dominantState(['green', 'yellow'])).toBe('yellow');
    expect(dominantState(['yellow', 'green', 'red'])).toBe('red');
    expect(dominantState(['green', 'update_required', 'red'])).toBe(
      'update_required',
    );
  });

  it('returns green for the empty input', () => {
    expect(dominantState([])).toBe('green');
  });
});

describe('todayIso', () => {
  it('formats a Date as YYYY-MM-DD in UTC', () => {
    expect(todayIso(new Date('2026-04-27T05:00:00Z'))).toBe('2026-04-27');
    // Late-evening IST is the next day in UTC — the function uses UTC.
    expect(todayIso(new Date('2026-04-27T22:00:00Z'))).toBe('2026-04-27');
  });
});

describe('buildCompat middleware (integration)', () => {
  // The middleware lives at the top of the chain, so any path that
  // isn't carved out exercises it. `/health` is carved out; we pick
  // a 404'd `/api/...` path so the request reaches the middleware
  // but doesn't need a session.
  const probePath = '/api/__missing_for_test__';

  it('lets in-window builds through (404 from notFound, not 426)', async () => {
    const today = todayIso();
    const res = await SELF.fetch(`http://api.test${probePath}`, {
      headers: { [BUILD_ID_HEADER]: `${today}.test` },
    });
    expect(res.status).toBe(404);
  });

  it('lets requests with no build header through (transitional)', async () => {
    const res = await SELF.fetch(`http://api.test${probePath}`);
    expect(res.status).toBe(404);
  });

  it('returns 426 with the canonical error shape for stale clients', async () => {
    // 30 days back is well past the 7-day window.
    const stale = '2025-01-01.test';
    const res = await SELF.fetch(`http://api.test${probePath}`, {
      headers: { [BUILD_ID_HEADER]: stale },
    });
    expect(res.status).toBe(426);
    const body = (await res.json()) as { error: { code: string; message?: string } };
    expect(body.error.code).toBe('upgrade_required');
    expect(body.error.message).toBeTruthy();
  });

  it('skips the gate on /health even with a stale build', async () => {
    const stale = '2025-01-01.test';
    const res = await SELF.fetch('http://api.test/health', {
      headers: { [BUILD_ID_HEADER]: stale },
    });
    expect(res.status).toBe(200);
  });

  it('skips the gate on the public /api/programs surface', async () => {
    const stale = '2025-01-01.test';
    const res = await SELF.fetch('http://api.test/api/programs/__missing__', {
      headers: { [BUILD_ID_HEADER]: stale },
    });
    // We don't care which exact status the route returns — only that
    // it isn't 426 (which would mean the gate fired).
    expect(res.status).not.toBe(426);
  });
});
