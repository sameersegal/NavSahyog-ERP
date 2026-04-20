import { describe, expect, it } from 'vitest';
import { can, type User } from '../src/api';

function userWith(caps: User['capabilities']): User {
  return {
    id: 1,
    user_id: 'x',
    full_name: 'X',
    role: 'vc',
    scope_level: 'village',
    scope_id: 1,
    capabilities: caps,
  };
}

describe('can()', () => {
  it('returns false for a null user', () => {
    expect(can(null, 'child.write')).toBe(false);
  });

  it('returns true when the cap is in user.capabilities', () => {
    expect(can(userWith(['child.read', 'child.write']), 'child.write')).toBe(true);
  });

  it('returns false when the cap is missing from user.capabilities', () => {
    // Simulates a future read-only role. The server is authoritative;
    // the client is hiding UI, not securing anything.
    expect(can(userWith(['child.read']), 'child.write')).toBe(false);
  });
});
