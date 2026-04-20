import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIsoDate, nowEpochSeconds, todayIstDate } from '../../src/lib/time';

describe('isIsoDate', () => {
  it('accepts a well-formed date', () => {
    expect(isIsoDate('2026-04-20')).toBe(true);
  });

  it('rejects a date with time components', () => {
    expect(isIsoDate('2026-04-20T00:00:00Z')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isIsoDate(20260420)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it('rejects partial dates', () => {
    expect(isIsoDate('2026-04')).toBe(false);
    expect(isIsoDate('26-04-20')).toBe(false);
  });
});

describe('todayIstDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The whole point of the helper: at 18:30 UTC the IST calendar
  // day has already flipped. UTC day start math gets this wrong.
  it('flips at 18:30 UTC for the IST day boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-19T18:29:00Z'));
    expect(todayIstDate()).toBe('2026-04-19');
    vi.setSystemTime(new Date('2026-04-19T18:31:00Z'));
    expect(todayIstDate()).toBe('2026-04-20');
  });

  it('returns the same IST date across a UTC midnight', () => {
    vi.useFakeTimers();
    // 2026-04-20 05:00 IST is still 2026-04-19 in UTC.
    vi.setSystemTime(new Date('2026-04-19T23:30:00Z'));
    expect(todayIstDate()).toBe('2026-04-20');
  });
});

describe('nowEpochSeconds', () => {
  it('returns an integer matching Date.now/1000', () => {
    const before = Math.floor(Date.now() / 1000);
    const n = nowEpochSeconds();
    const after = Math.floor(Date.now() / 1000);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(before);
    expect(n).toBeLessThanOrEqual(after);
  });
});
