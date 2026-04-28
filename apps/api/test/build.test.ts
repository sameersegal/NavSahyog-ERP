// L4.0a/c — Build-id compat (decisions.md D29, D31).
//
// Pure-helper tests for shared/src/sync.ts plus integration tests
// for apps/api/src/lib/build.ts middleware behaviour against the
// running Worker. The test config sets MIN_SUPPORTED_BUILD to
// `2020-01-01.test` and SERVER_BUILD_ID to `2026-04-27.test` so
// the middleware path is exercised; tests that want a stale-client
// 426 use a build dated before the floor.

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  BUILD_ID_HEADER,
  SERVER_BUILD_HEADER,
  checkCompat,
  checkFloor,
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

describe('checkCompat (soft, time-based — used by client banner)', () => {
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

  it("treats future-dated builds as ok (clock skew is the server's problem)", () => {
    expect(checkCompat('2026-05-10', today).kind).toBe('ok');
  });

  it('returns unknown_build for missing or malformed headers', () => {
    expect(checkCompat(null, today).kind).toBe('unknown_build');
    expect(checkCompat('not-a-build', today).kind).toBe('unknown_build');
  });
});

describe('checkFloor (hard, operator-managed — used by server middleware)', () => {
  it('accepts everything when no floor is set', () => {
    expect(checkFloor('2020-01-01', null).kind).toBe('ok');
    expect(checkFloor('2020-01-01', undefined).kind).toBe('ok');
    expect(checkFloor('2020-01-01', '').kind).toBe('ok');
  });

  it('accepts client builds at or above the floor', () => {
    expect(checkFloor('2026-04-27', '2026-04-20').kind).toBe('ok');
    expect(checkFloor('2026-04-20', '2026-04-20').kind).toBe('ok');
    expect(checkFloor('2027-01-01', '2026-04-20').kind).toBe('ok');
  });

  it('rejects client builds strictly older than the floor', () => {
    const v = checkFloor('2026-04-19', '2026-04-20');
    expect(v.kind).toBe('too_old');
    if (v.kind === 'too_old') expect(v.days).toBe(1);
  });

  it('returns unknown_build for missing or malformed client builds', () => {
    expect(checkFloor(null, '2026-04-20').kind).toBe('unknown_build');
    expect(checkFloor('garbage', '2026-04-20').kind).toBe('unknown_build');
  });

  it('fails open on a malformed floor (operator typo)', () => {
    expect(checkFloor('2026-04-27', 'garbage').kind).toBe('ok');
  });

  it("doesn't anchor on wall clock — old client + ancient floor still passes", () => {
    // Regression for the deploy-grace bug: comparing client-build to
    // "today" would 426 a year-old client even when the operator's
    // floor is itself a year ago.
    expect(checkFloor('2025-01-01', '2025-01-01').kind).toBe('ok');
    expect(checkFloor('2025-12-31', '2025-01-01').kind).toBe('ok');
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
    expect(todayIso(new Date('2026-04-27T22:00:00Z'))).toBe('2026-04-27');
  });
});

describe('buildCompat middleware (integration — floor at 2020-01-01)', () => {
  // Test config sets MIN_SUPPORTED_BUILD = '2020-01-01.test'.
  // Anything dated 2020-01-01 or later passes; older 426s.
  const probePath = '/api/__missing_for_test__';

  it('lets in-window builds through (404 from notFound, not 426)', async () => {
    const res = await SELF.fetch(`http://api.test${probePath}`, {
      headers: { [BUILD_ID_HEADER]: '2026-04-27.test' },
    });
    expect(res.status).toBe(404);
  });

  it('lets requests with no build header through (transitional)', async () => {
    const res = await SELF.fetch(`http://api.test${probePath}`);
    expect(res.status).toBe(404);
  });

  it('returns 426 with the canonical error shape for sub-floor clients', async () => {
    // 2019-12-31 is one day before the test floor of 2020-01-01.
    const stale = '2019-12-31.test';
    const res = await SELF.fetch(`http://api.test${probePath}`, {
      headers: { [BUILD_ID_HEADER]: stale },
    });
    expect(res.status).toBe(426);
    const body = (await res.json()) as { error: { code: string; message?: string } };
    expect(body.error.code).toBe('upgrade_required');
    expect(body.error.message).toBeTruthy();
    expect(body.error.message).toContain('2020-01-01');
  });

  it('skips the gate on /health even with a stale build', async () => {
    const res = await SELF.fetch('http://api.test/health', {
      headers: { [BUILD_ID_HEADER]: '2019-01-01.test' },
    });
    expect(res.status).toBe(200);
  });

  it('skips the gate on the public /api/programs surface', async () => {
    const res = await SELF.fetch('http://api.test/api/programs/__missing__', {
      headers: { [BUILD_ID_HEADER]: '2019-01-01.test' },
    });
    expect(res.status).not.toBe(426);
  });
});

describe('serverBuildStamp middleware', () => {
  it('stamps X-Server-Build on a successful response', async () => {
    const res = await SELF.fetch('http://api.test/health');
    expect(res.headers.get(SERVER_BUILD_HEADER)).toBe('2026-04-27.test');
  });

  it('stamps X-Server-Build on an error response too', async () => {
    const res = await SELF.fetch('http://api.test/api/__missing__');
    expect(res.status).toBe(404);
    expect(res.headers.get(SERVER_BUILD_HEADER)).toBe('2026-04-27.test');
  });

  it('stamps even when the request is 426', async () => {
    const res = await SELF.fetch('http://api.test/api/__missing__', {
      headers: { [BUILD_ID_HEADER]: '2019-01-01.test' },
    });
    expect(res.status).toBe(426);
    expect(res.headers.get(SERVER_BUILD_HEADER)).toBe('2026-04-27.test');
  });
});
