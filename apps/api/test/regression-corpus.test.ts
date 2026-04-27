// Regression corpus harness (L4.0d — decisions.md D30 additive-only
// contract).
//
// Walks `regression-corpus/**/*.json` and replays every payload
// against the running Worker. A payload that previously succeeded
// must keep succeeding forever — that's how we enforce the
// additive-only rule on offline-eligible endpoints. A non-2xx
// response from any historical payload means a deployed client
// with a queued mutation in that shape would dead-letter on drain.
//
// L4.0d ships the harness; the corpus itself is empty until L4.1's
// first offline-eligible workflow lands. The empty-corpus pass
// keeps CI green; the harness self-test below proves the replay
// logic works without depending on the corpus directory's contents.

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applySchemaAndSeed, loginAs } from './setup';

type CorpusPayload = {
  name: string;
  body: unknown;
};

type CorpusFile = {
  release: string;
  endpoint: string; // 'METHOD /path/to/endpoint'
  schema_version?: number;
  // Override the default test user (vc-anandpur) for this file.
  // Useful for pond/cluster-admin payloads that need write caps
  // a VC doesn't carry.
  login_as?: string;
  payloads: CorpusPayload[];
};

const corpusModules = import.meta.glob<CorpusFile>(
  '../../../regression-corpus/**/*.json',
  { import: 'default', eager: true },
);

const corpusEntries = Object.entries(corpusModules);

const ENDPOINT_RE = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)$/;

async function replayPayload(
  fetcher: { fetch: typeof SELF.fetch },
  cookieToken: string,
  endpoint: string,
  body: unknown,
): Promise<Response> {
  const m = ENDPOINT_RE.exec(endpoint);
  if (!m) {
    throw new Error(
      `corpus endpoint must be 'METHOD /path' (got ${JSON.stringify(endpoint)})`,
    );
  }
  const method = m[1]!;
  const path = m[2]!;
  return fetcher.fetch(`http://api.test${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: `nsf_session=${cookieToken}`,
    },
    body: method === 'GET' || method === 'DELETE'
      ? undefined
      : JSON.stringify(body),
  });
}

beforeAll(async () => {
  await applySchemaAndSeed(env.DB);
});

describe('regression corpus (additive-only contract)', () => {
  if (corpusEntries.length === 0) {
    // Empty corpus — placeholder pass so CI stays green until L4.1's
    // first offline-eligible endpoint adds payloads. Removing this
    // case once payloads land is the natural cleanup.
    it('no corpus files yet — first offline-eligible endpoint adds one', () => {
      expect(corpusEntries).toHaveLength(0);
    });
    return;
  }

  for (const [path, file] of corpusEntries) {
    describe(`${path}`, () => {
      let cookieToken: string;
      beforeAll(async () => {
        cookieToken = await loginAs(file.login_as ?? 'vc-anandpur');
      });

      for (const payload of file.payloads) {
        it(`${file.release} :: ${file.endpoint} — ${payload.name}`, async () => {
          const res = await replayPayload(
            SELF,
            cookieToken,
            file.endpoint,
            payload.body,
          );
          if (res.status >= 400) {
            const detail = await res.text();
            throw new Error(
              `additive-only contract violated.\n` +
                `  release:  ${file.release}\n` +
                `  endpoint: ${file.endpoint}\n` +
                `  payload:  ${payload.name}\n` +
                `  status:   ${res.status}\n` +
                `  body:     ${detail.slice(0, 500)}`,
            );
          }
          expect(res.status).toBeLessThan(400);
        });
      }
    });
  }
});

// Self-test of the harness itself. The real corpus is empty in
// L4.0d, so without this block the file would only test the
// "no corpus yet" branch. These cases prove `replayPayload`
// actually round-trips a request and the parser rejects malformed
// endpoint strings.
describe('regression corpus harness — self-test', () => {
  let cookieToken: string;
  beforeAll(async () => {
    cookieToken = await loginAs('vc-anandpur');
  });

  it('replayPayload round-trips a known-good GET against the live worker', async () => {
    // /api/villages exists, returns 200 for a logged-in VC.
    const res = await replayPayload(
      SELF,
      cookieToken,
      'GET /api/villages',
      undefined,
    );
    expect(res.status).toBeLessThan(400);
  });

  it('replayPayload returns the failure status for a known-bad request', async () => {
    // Missing required body fields → 400.
    const res = await replayPayload(
      SELF,
      cookieToken,
      'POST /api/attendance',
      {},
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects malformed endpoint strings', async () => {
    await expect(
      replayPayload(SELF, cookieToken, 'no-method', undefined),
    ).rejects.toThrow(/METHOD \/path/);
    await expect(
      replayPayload(SELF, cookieToken, 'GET no-leading-slash', undefined),
    ).rejects.toThrow(/METHOD \/path/);
  });
});
