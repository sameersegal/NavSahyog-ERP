import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { err } from '../../src/lib/errors';

// Build a tiny app that calls `err()` on a /test route. We use the
// real Hono request machinery so the response shape and status are
// what a client would actually see.
function appEmitting(code: Parameters<typeof err>[1], status: 400 | 403 | 404 | 500, message?: string) {
  const app = new Hono();
  app.get('/test', (c) => err(c, code, status, message));
  return app;
}

describe('err()', () => {
  it('produces the canonical { error: { code } } shape', async () => {
    const res = await appEmitting('forbidden', 403).request('/test');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'forbidden' } });
  });

  it('includes `message` when provided', async () => {
    const res = await appEmitting('bad_request', 400, 'village_id required').request('/test');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'bad_request', message: 'village_id required' },
    });
  });

  it('omits `message` when not provided', async () => {
    const res = await appEmitting('not_found', 404).request('/test');
    const body = (await res.json()) as { error: { code: string; message?: string } };
    expect(body.error).not.toHaveProperty('message');
  });
});
