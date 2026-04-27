// Public, embeddable program API smoke. The route is no-auth and
// designed to be embedded cross-origin, so the guarantees worth
// pinning are: it answers without a session cookie, the response
// shape matches what an embedder expects, the counts add up,
// coordinates are coarsened, and no PII leaks on the wire.

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applySchemaAndSeed } from './setup';

beforeAll(async () => {
  await applySchemaAndSeed(env.DB);
});

type ProgramPond = {
  id: number;
  latitude: number;
  longitude: number;
  status: 'planned' | 'dug' | 'active' | 'inactive';
  village: string;
  cluster: string;
  district: string;
  state: string;
  zone: string;
  created_at: number;
};
type ProgramResponse = {
  program: string;
  stats: {
    total: number;
    by_status: Record<string, number>;
    by_state: Array<{ state: string; count: number }>;
    villages: number;
    districts: number;
    states: number;
  };
  ponds: ProgramPond[];
};

describe('GET /api/programs/jal-vriddhi', () => {
  it('answers 200 with no session cookie and a sane response shape', async () => {
    const res = await SELF.fetch('http://api.test/api/programs/jal-vriddhi');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProgramResponse;

    expect(body.program).toBe('jal-vriddhi');
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

    for (const p of body.ponds) {
      expect(['planned', 'dug', 'active', 'inactive']).toContain(p.status);
      expect(typeof p.latitude).toBe('number');
      expect(typeof p.longitude).toBe('number');
    }
  });

  it('strips PII — no names, plot ids, phones, notes, or agreement metadata', async () => {
    const res = await SELF.fetch('http://api.test/api/programs/jal-vriddhi');
    const body = (await res.json()) as ProgramResponse;
    const wire = JSON.stringify(body);

    // Row-level PII fields must be absent entirely from the payload.
    for (const field of [
      'farmer_first_name', 'farmer_full_name', 'full_name',
      'phone', 'plot_identifier', 'plot', 'notes',
      'uuid', 'r2_key', 'original_filename',
      'created_by', 'uploaded_by',
    ]) {
      expect(wire, `field "${field}" leaked into public payload`).not.toMatch(
        new RegExp(`"${field}"`),
      );
    }

    // String-content checks: even if someone adds a passthrough
    // later, common PII shapes (Indian phones, survey numbers, sample
    // farmer first names from the seed) must not appear in the body.
    expect(wire).not.toMatch(/\+91\d/);
    expect(wire).not.toMatch(/Survey \d/);
    expect(wire).not.toMatch(/\bPlot \d/);
    for (const seedName of [
      'Bharath', 'Sushila', 'Manjunath', 'Veeresh', 'Imran',
      'Saravanan', 'Murali', 'Selvi', 'Karuppayee', 'Bendang',
    ]) {
      expect(wire, `seed farmer name "${seedName}" leaked`).not.toContain(seedName);
    }
  });

  it('coarsens coordinates to 3 decimal places (~110 m)', async () => {
    const res = await SELF.fetch('http://api.test/api/programs/jal-vriddhi');
    const body = (await res.json()) as ProgramResponse;

    for (const p of body.ponds) {
      // Math.round(lat*1000)/1000 — invariant: lat*1000 is an integer.
      expect(Number.isInteger(Math.round(p.latitude * 1000))).toBe(true);
      expect(p.latitude * 1000).toBe(Math.round(p.latitude * 1000));
      expect(p.longitude * 1000).toBe(Math.round(p.longitude * 1000));
    }
  });

  it('returns CORS headers permitting any origin to read', async () => {
    const res = await SELF.fetch('http://api.test/api/programs/jal-vriddhi', {
      headers: { origin: 'https://navsahyog.example' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    // Credentials are explicitly off — the surface is no-cookie.
    expect(res.headers.get('access-control-allow-credentials')).not.toBe('true');
  });
});
