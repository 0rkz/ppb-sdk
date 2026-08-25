/**
 * GatewayClient tests — covers the two 0.3.1 fixes:
 *
 *  1. Method resolution no longer trusts a hardcoded POST_ORACLES list first.
 *     It prefers the live `GET /feeds` catalog's per-feed `method[]`, and
 *     only falls back to POST_ORACLES when the catalog fetch itself fails
 *     (fail-open, never silently to GET-always).
 *
 *  2. shapeResult() is rewritten against the REAL @x402/core@2.13+ client
 *     contract — `{status, paymentStatus, body, header}` — not the
 *     `result.kind` shape that never existed in that package. In particular
 *     a paid 2xx whose PAYMENT-RESPONSE header is missing/undecodable
 *     (paymentStatus 'none') must return the body with settlement: null, NOT
 *     throw — that was the live regression (a real settled $0.01 Base
 *     payment threw "gateway error 200" in the SDK).
 *
 * No network: fetch is mocked with real `Response` objects (Node's global
 * fetch/Response/Headers), and shapeResult (a private method) is exercised
 * directly with objects shaped like the real HTTPResourceResponse so the
 * mapping is tested independently of @x402/core's own header-decoding
 * internals (already verified by reading its dist source — see gateway.ts's
 * shapeResult doc comment).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { GatewayClient, GatewayError } from './gateway';

const BASE_URL = 'https://x402.test.invalid';

function fakeSigner() {
  return { address: '0x1111111111111111111111111111111111111111', signTypedData: async () => '0xdead' };
}

function newClient() {
  return new GatewayClient({ baseUrl: BASE_URL, signer: fakeSigner() });
}

/** Minimal live-shaped /feeds catalog fixture (subset of the real schema). */
function catalogResponse(feeds: Array<{ id: string; method: Array<'GET' | 'POST'> }>) {
  return new Response(
    JSON.stringify({
      protocol: 'PayPerByte x402 Gateway',
      version: '0.3.0',
      networks: ['eip155:8453'],
      facilitator: 'https://api.cdp.coinbase.com/platform/v2/x402',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      pricing: { model: 'fixed-per-call', pricePerKB: '$0.005000', floor: '$0.001000', note: '' },
      disclaimers: { header: 'X-BYTE-Disclaimer-Category', note: '', text: {} },
      feeds: feeds.map((f) => ({
        id: f.id,
        name: f.id,
        description: f.id,
        price: '$0.0100',
        priceAtomic: '10000',
        expectedSizeBytes: 100,
        provenance: 'eip712-attested',
        updateFrequency: '3600s',
        endpoint: `/feeds/${f.id}`,
        disclaimerCategory: 'general',
        method: f.method,
      })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GatewayClient method resolution (Bug 1: stale hardcoded POST_ORACLES)', () => {
  it('explicit options.method wins and never triggers a catalog fetch', async () => {
    const client = newClient();
    const resolveSpy = vi.spyOn(client as any, 'resolveMethod');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const res = await client.fetchFeed('weather', { method: 'POST', body: { x: 1 } });

    expect(resolveSpy).not.toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(res.data).toEqual({ ok: true });
  });

  it('derives POST from the live catalog for a POST-only feed absent from any hardcoded list (cctp-attestation-latency)', async () => {
    const client = newClient();
    const calls: Array<{ url: string; method?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.endsWith('/feeds')) {
        return catalogResponse([
          { id: 'weather', method: ['GET'] },
          { id: 'cctp-attestation-latency', method: ['POST'] },
        ]);
      }
      // The feed endpoint itself — paid 200, no settlement header (irrelevant
      // to this test; only the outgoing method matters here).
      return new Response(JSON.stringify({ answer: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await client.fetchFeed('cctp-attestation-latency', { body: { x: 1 } });

    const feedCall = calls.find((c) => c.url.endsWith('/feeds/cctp-attestation-latency'));
    expect(feedCall?.method).toBe('POST');
  });

  it('derives GET from the live catalog for a dual GET/POST feed when no method is given', async () => {
    const client = newClient();
    const calls: Array<{ url: string; method?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.endsWith('/feeds')) {
        return catalogResponse([{ id: 'runtime-eol', method: ['GET', 'POST'] }]);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await client.fetchFeed('runtime-eol');

    const feedCall = calls.find((c) => c.url.endsWith('/feeds/runtime-eol'));
    expect(feedCall?.method).toBe('GET');
  });

  it('falls back to POST_ORACLES (never to GET-always) when the catalog fetch fails', async () => {
    const client = newClient();
    const calls: Array<{ url: string; method?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.endsWith('/feeds')) {
        throw new TypeError('network error');
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await client.fetchFeed('address-reputation', { body: {} });

    const feedCall = calls.find((c) => c.url.endsWith('/feeds/address-reputation'));
    expect(feedCall?.method).toBe('POST');
  });

  it('caches the catalog: a second fetchFeed call does not re-fetch /feeds', async () => {
    const client = newClient();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.endsWith('/feeds')) {
        return catalogResponse([{ id: 'weather', method: ['GET'] }]);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await client.fetchFeed('weather');
    await client.fetchFeed('weather');

    const catalogCalls = fetchSpy.mock.calls.filter(([input]) => String(input).endsWith('/feeds'));
    expect(catalogCalls.length).toBe(1);
  });
});

describe('GatewayClient.shapeResult (Bug 2: rewritten against the real @x402/core contract)', () => {
  let client: GatewayClient;

  beforeEach(() => {
    client = newClient();
  });

  it('paid 200 WITH a valid SettleResponse header -> data + settlement', () => {
    const result = {
      status: 200,
      paymentStatus: 'settled' as const,
      body: { answer: { latencyMs: 42 }, attestation: { hash: '0xabc' } },
      header: {
        success: true,
        payer: '0x2222222222222222222222222222222222222222',
        transaction: '0xa610b39978132b886b0ff73311d238a4b131fbe8cabffd475a9555b429b0913a',
        network: 'eip155:8453',
      },
    };

    const shaped = (client as any).shapeResult(result, 'general');

    expect(shaped.data).toEqual(result.body);
    expect(shaped.settlement).toEqual({
      success: true,
      payer: '0x2222222222222222222222222222222222222222',
      transaction: '0xa610b39978132b886b0ff73311d238a4b131fbe8cabffd475a9555b429b0913a',
    });
    expect(shaped.disclaimerCategory).toBe('general');
  });

  it('paid 200 WITHOUT a settlement header must NOT throw (the live regression) -> data with settlement: null', () => {
    // Reconstructed from the actual founder-hit response shape: a real
    // $0.01 Base settle (tx 0xa610b399...0913a, confirmed in the gateway's
    // delivery log) whose PAYMENT-RESPONSE header the SDK never saw, so
    // @x402/core's parsePaymentResult produced paymentStatus: 'none' on a
    // 200 — not 'settled'. The old `result.kind`-based switch had no case
    // for this and fell through to `default` -> threw "gateway error 200"
    // on a successful, paid, delivered response.
    const result = {
      status: 200,
      paymentStatus: 'none' as const,
      body: { answer: { latencyMs: 42 }, attestation: { hash: '0xabc' } },
      header: undefined,
    };

    const shaped = (client as any).shapeResult(result, 'general');

    expect(shaped.data).toEqual(result.body);
    expect(shaped.settlement).toBeNull();
  });

  it('still 402 after paying (payment_required) -> throws GatewayError, does not swallow the body', () => {
    const result = {
      status: 402,
      paymentStatus: 'payment_required' as const,
      body: { error: 'insufficient funds' },
      header: { error: 'insufficient funds' },
    };

    let caught: unknown;
    try {
      (client as any).shapeResult(result, undefined);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(GatewayError);
    expect((caught as GatewayError).status).toBe(402);
    expect((caught as GatewayError).body).toEqual(result.body);
    expect((caught as GatewayError).message).toMatch(/not satisfiable/);
  });

  it('settlement failed on-chain (settle_failed) -> throws GatewayError carrying the settle response', () => {
    const result = {
      status: 200,
      paymentStatus: 'settle_failed' as const,
      body: { answer: {} },
      header: { success: false, errorReason: 'insufficient_funds', transaction: '0xdead', network: 'eip155:8453' },
    };

    let caught: unknown;
    try {
      (client as any).shapeResult(result, undefined);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(GatewayError);
    expect((caught as GatewayError).settleResponse).toEqual(result.header);
    expect((caught as GatewayError).message).toMatch(/settlement failed/);
  });

  it('non-2xx with no payment header (e.g. 500) -> throws a generic GatewayError', () => {
    const result = {
      status: 500,
      paymentStatus: 'none' as const,
      body: { error: 'internal error' },
      header: undefined,
    };

    let caught: unknown;
    try {
      (client as any).shapeResult(result, undefined);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(GatewayError);
    expect((caught as GatewayError).status).toBe(500);
    expect((caught as GatewayError).body).toEqual(result.body);
  });
});

describe('GatewayClient.fetchFeed end-to-end regression (mocked fetch, real @x402/core wiring)', () => {
  it('a free/already-settled 2xx with no payment header returns data without throwing', async () => {
    const client = newClient();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.endsWith('/feeds')) {
        return catalogResponse([{ id: 'weather', method: ['GET'] }]);
      }
      // No PAYMENT-RESPONSE header on this 200 — the exact live-hit shape.
      return new Response(JSON.stringify({ answer: { forecast: 'sunny' } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'X-BYTE-Disclaimer-Category': 'general' },
      });
    });

    const res = await client.fetchFeed('weather');

    expect(res.data).toEqual({ answer: { forecast: 'sunny' } });
    expect(res.settlement).toBeNull();
    expect(res.disclaimerCategory).toBe('general');
  });
});
