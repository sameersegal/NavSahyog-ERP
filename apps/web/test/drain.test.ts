// Drain runner integration (L4.0b — decisions.md D29, D32).
//
// Mocks fetch via the runner's `fetchImpl` option so we can assert
// the right verdict for each HTTP class without touching network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drain } from '../src/lib/drain';
import { enqueue, listAll } from '../src/lib/outbox';
import { deleteDatabase } from '../src/lib/idb';
import { UPGRADE_REQUIRED_EVENT } from '../src/lib/events';
import { BUILD_ID_HEADER, SCHEMA_VERSION_HEADER } from '@navsahyog/shared';

beforeEach(async () => {
  await deleteDatabase();
});

afterEach(async () => {
  await deleteDatabase();
});

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('drain runner', () => {
  it('marks 2xx responses as done and reports drained count', async () => {
    await enqueue({
      method: 'POST',
      path: '/api/x',
      body: { hello: 'world' },
      schema_version: 1,
    });
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const result = await drain({ fetchImpl, isOnline: () => true });
    expect(result.drained).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const all = await listAll();
    expect(all[0]!.status).toBe('done');
  });

  it('sends idempotency-key, build-id, and schema-version headers', async () => {
    await enqueue({
      method: 'POST',
      path: '/api/x',
      body: { v: 1 },
      schema_version: 7,
    });
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    await drain({ fetchImpl, isOnline: () => true });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers[BUILD_ID_HEADER]).toBeTruthy();
    expect(headers[SCHEMA_VERSION_HEADER]).toBe('7');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('marks 5xx responses as failed (retryable)', async () => {
    await enqueue({
      method: 'POST',
      path: '/api/x',
      body: null,
      schema_version: 1,
    });
    const fetchImpl = vi.fn(async () =>
      jsonResponse(500, { error: { code: 'internal_error' } }),
    );
    const result = await drain({ fetchImpl, isOnline: () => true });
    expect(result.failed).toBe(1);
    const all = await listAll();
    expect(all[0]!.status).toBe('failed');
    expect(all[0]!.attempts).toBe(1);
  });

  it('marks terminal 4xx (e.g., 409) as dead-letter', async () => {
    await enqueue({
      method: 'POST',
      path: '/api/x',
      body: null,
      schema_version: 1,
    });
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { error: { code: 'conflict', message: 'dup' } }),
    );
    const result = await drain({ fetchImpl, isOnline: () => true });
    expect(result.deadLettered).toBe(1);
    const all = await listAll();
    expect(all[0]!.status).toBe('dead_letter');
    expect(all[0]!.last_error).toContain('409');
  });

  it('on 426 dispatches the upgrade event and stops the loop', async () => {
    await enqueue({
      method: 'POST',
      path: '/api/x',
      body: null,
      schema_version: 1,
    });
    await enqueue({
      method: 'POST',
      path: '/api/y',
      body: null,
      schema_version: 1,
    });
    const fetchImpl = vi.fn(async () =>
      jsonResponse(426, { error: { code: 'upgrade_required' } }),
    );
    const handler = vi.fn();
    window.addEventListener(UPGRADE_REQUIRED_EVENT, handler);
    const result = await drain({ fetchImpl, isOnline: () => true });
    window.removeEventListener(UPGRADE_REQUIRED_EVENT, handler);
    expect(result.upgrade_required).toBe(true);
    // Only the first row was attempted; the loop bailed on 426.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('treats network errors as retryable', async () => {
    await enqueue({
      method: 'POST',
      path: '/api/x',
      body: null,
      schema_version: 1,
    });
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await drain({ fetchImpl, isOnline: () => true });
    expect(result.failed).toBe(1);
    const all = await listAll();
    expect(all[0]!.status).toBe('failed');
    expect(all[0]!.last_error).toContain('network');
  });

  it('does nothing when isOnline() returns false', async () => {
    await enqueue({
      method: 'POST',
      path: '/api/x',
      body: null,
      schema_version: 1,
    });
    const fetchImpl = vi.fn();
    const result = await drain({ fetchImpl, isOnline: () => false });
    expect(result.drained).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('drains multiple queued rows in one invocation', async () => {
    for (let i = 0; i < 3; i++) {
      await enqueue({
        method: 'POST',
        path: `/api/x/${i}`,
        body: { i },
        schema_version: 1,
      });
    }
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const result = await drain({ fetchImpl, isOnline: () => true });
    expect(result.drained).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
