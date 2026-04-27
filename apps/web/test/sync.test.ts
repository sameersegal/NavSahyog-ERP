// Pure-helper tests for the L4.0b additions to packages/shared/src/sync.ts.
// IDB-touching code lives in outbox.test.ts + drain.test.ts.

import { describe, expect, it } from 'vitest';
import {
  OUTBOX_BACKOFF_MS,
  OUTBOX_MAX_ATTEMPTS,
  nextBackoffMs,
  ulid,
} from '@navsahyog/shared';

describe('nextBackoffMs', () => {
  it('returns the schedule entries in order', () => {
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
      expect(nextBackoffMs(i)).toBe(OUTBOX_BACKOFF_MS[i]);
    }
  });

  it('returns null once attempts hits the max', () => {
    expect(nextBackoffMs(OUTBOX_MAX_ATTEMPTS)).toBeNull();
    expect(nextBackoffMs(OUTBOX_MAX_ATTEMPTS + 1)).toBeNull();
  });

  it('treats negative attempts as the first wait (defensive)', () => {
    expect(nextBackoffMs(-1)).toBe(OUTBOX_BACKOFF_MS[0]);
  });
});

describe('ulid', () => {
  it('produces a 26-char Crockford-base32 string', () => {
    const id = ulid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('sorts lexicographically by encoded time', () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    const c = ulid(1_700_000_001_000);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it('is unique across rapid calls at the same timestamp', () => {
    const ts = Date.now();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(ulid(ts));
    expect(ids.size).toBe(1000);
  });

  it('honours a deterministic rng for reproducible tests', () => {
    const rng = () => 0; // first symbol is always '0'
    const id = ulid(0, rng);
    expect(id).toBe('0'.repeat(26));
  });
});
