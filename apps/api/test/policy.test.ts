import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { can, capabilitiesFor, requireCap } from '../src/policy';
import type { Bindings, Role, SessionUser, Variables } from '../src/types';

function userWithRole(role: Role): SessionUser {
  return {
    id: 1,
    user_id: `${role}-1`,
    full_name: 'Test',
    role,
    scope_level: role === 'super_admin' ? 'global' : 'village',
    scope_id: role === 'super_admin' ? null : 1,
  };
}

describe('can()', () => {
  it('returns true for every capability every L1 role currently carries', () => {
    const allCaps = [
      'village.read',
      'school.read',
      'child.read',
      'child.write',
      'attendance.read',
      'attendance.write',
      'dashboard.read',
    ] as const;
    for (const role of ['vc', 'af', 'cluster_admin', 'super_admin'] as const) {
      for (const cap of allCaps) {
        expect(can(userWithRole(role), cap)).toBe(true);
      }
    }
  });
});

describe('capabilitiesFor()', () => {
  it('returns the role\'s capability list as declared', () => {
    expect(capabilitiesFor('vc')).toContain('child.write');
    expect(capabilitiesFor('super_admin')).toContain('dashboard.read');
  });
});

describe('requireCap middleware', () => {
  function appWith(cap: Parameters<typeof requireCap>[0], user: SessionUser) {
    const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.set('user', user);
      await next();
    });
    app.get('/guarded', requireCap(cap), (c) => c.json({ ok: true }));
    return app;
  }

  it('passes through when the role carries the cap', async () => {
    const app = appWith('child.write', userWithRole('vc'));
    const res = await app.request('/guarded');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns the canonical 403 shape when the role does not carry the cap', async () => {
    // Simulate a future read-only role by handing `can` a role that
    // isn't in CAPABILITIES_BY_ROLE. Cast through unknown — we're
    // specifically testing the "missing from map" branch.
    const fakeUser = { ...userWithRole('vc'), role: 'district_admin' as unknown as Role };
    const app = appWith('child.write', fakeUser);
    const res = await app.request('/guarded');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'forbidden' } });
  });
});
