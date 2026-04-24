import { describe, expect, it } from 'vitest';
import { relativeTime } from '../src/lib/date';

// Pin `now` so the output is deterministic.
const NOW = new Date('2026-04-24T12:00:00Z').getTime();

describe('relativeTime', () => {
  it('formats minutes ago in English', () => {
    const five_min_ago = Math.floor(NOW / 1000) - 5 * 60;
    expect(relativeTime(five_min_ago, 'en', NOW)).toBe('5 minutes ago');
  });

  it('formats hours ago in English', () => {
    const three_h_ago = Math.floor(NOW / 1000) - 3 * 60 * 60;
    expect(relativeTime(three_h_ago, 'en', NOW)).toBe('3 hours ago');
  });

  it('formats days ago in English', () => {
    const two_days_ago = Math.floor(NOW / 1000) - 2 * 24 * 60 * 60;
    expect(relativeTime(two_days_ago, 'en', NOW)).toBe('2 days ago');
  });

  it('produces a string for Hindi without throwing', () => {
    const one_hour_ago = Math.floor(NOW / 1000) - 60 * 60;
    expect(typeof relativeTime(one_hour_ago, 'hi', NOW)).toBe('string');
  });
});
