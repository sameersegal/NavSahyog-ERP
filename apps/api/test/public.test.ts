// Donor-facing public endpoint smoke. The route is no-auth, so the
// only guarantees worth pinning are: it answers without a session
// cookie, the response shape is what the donor SPA expects, the
// counts add up, and PII is not leaked (no phone numbers, no last
// names, no agreement uuids).

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applySchemaAndSeed } from './setup';

beforeAll(async () => {
  await applySchemaAndSeed(env.DB);
});

type PublicPond = {
  id: number;
  latitude: number;
  longitude: number;
  status: 'planned' | 'dug' | 'active' | 'inactive';
  notes: string | null;
  farmer_first_name: string;
  plot_identifier: string | null;
  village: string;
  cluster: string;
  district: string;
  state: string;
  zone: string;
  created_at: number;
};
type PublicResponse = {
  stats: {
    total: number;
    by_status: Record<string, number>;
    by_state: Array<{ state: string; count: number }>;
    villages: number;
    districts: number;
    states: number;
  };
  ponds: PublicPond[];
};

describe('GET /api/public/ponds', () => {
  it('answers 200 with no session cookie and a sane response shape', async () => {
    const res = await SELF.fetch('http://api.test/api/public/ponds');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicResponse;

    expect(body.ponds.length).toBeGreaterThan(0);
    expect(body.stats.total).toBe(body.ponds.length);

    const sumByStatus = Object.values(body.stats.by_status).reduce(
      (a, b) => a + b,
      0,
    );
    expect(sumByStatus).toBe(body.stats.total);

    expect(body.stats.by_state.length).toBeGreaterThan(0);
    const sumByState = body.stats.by_state.reduce((a, r) => a + r.count, 0);
    expect(sumByState).toBe(body.stats.total);
  });

  it('strips PII — no phone, no last name, no agreement uuid', async () => {
    const res = await SELF.fetch('http://api.test/api/public/ponds');
    const body = (await res.json()) as PublicResponse;
    const wire = JSON.stringify(body);

    expect(wire).not.toMatch(/\+91\d/);
    expect(wire).not.toMatch(/uuid/i);
    expect(wire).not.toMatch(/r2_key/i);

    for (const p of body.ponds) {
      expect(p.farmer_first_name).not.toMatch(/\s/);
      expect(typeof p.latitude).toBe('number');
      expect(typeof p.longitude).toBe('number');
      expect(['planned', 'dug', 'active', 'inactive']).toContain(p.status);
    }
  });
});
