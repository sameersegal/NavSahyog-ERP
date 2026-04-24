import { describe, expect, it } from 'vitest';
import { relativeTime } from '../src/lib/date';

// Pin `now` so the output is deterministic.
const NOW = new Date('2026-04-24T12:00:00Z').getTime();

describe('relativeTime', () => {
  it('formats minutes ago in English', () => {
    const fiveMinAgo = Math.floor(NOW / 1000) - 5 * 60;
    // Regex — ICU data can render "5 minutes ago" vs "5 min. ago"
    // between Node versions; we only care that it's a minutes-ago
    // string and not hours or days.
    expect(relativeTime(fiveMinAgo, 'en', NOW)).toMatch(/\b5\b/);
    expect(relativeTime(fiveMinAgo, 'en', NOW)).toMatch(/min/i);
  });

  it('formats hours ago in English', () => {
    const threeHAgo = Math.floor(NOW / 1000) - 3 * 60 * 60;
    expect(relativeTime(threeHAgo, 'en', NOW)).toMatch(/\b3\b/);
    expect(relativeTime(threeHAgo, 'en', NOW)).toMatch(/hour/i);
  });

  it('formats days ago in English', () => {
    const twoDaysAgo = Math.floor(NOW / 1000) - 2 * 24 * 60 * 60;
    expect(relativeTime(twoDaysAgo, 'en', NOW)).toMatch(/\b2\b/);
    expect(relativeTime(twoDaysAgo, 'en', NOW)).toMatch(/day/i);
  });

  it('produces a non-empty string for Hindi without throwing', () => {
    const oneHourAgo = Math.floor(NOW / 1000) - 60 * 60;
    const result = relativeTime(oneHourAgo, 'hi', NOW);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
