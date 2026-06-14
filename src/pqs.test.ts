/**
 * getPQS() tests — thin REST client over GET /publisher/{addr}/pqs.
 *
 * Acceptance (PHASE0_TRUST_KIT_SDK_SPEC):
 *  - returns the indexer composite for a scored publisher
 *  - returns composite=null for an unscored publisher (indexer 404)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPQS } from './pqs';

const INDEXER = 'http://localhost:8080';
const PUB = '0x1234567890abcdef1234567890ABCDEF12345678';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body?: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 404 ? 'Not Found' : status === 500 ? 'Internal Server Error' : 'OK',
    json: async () => body,
  } as Response);
}

describe('getPQS', () => {
  it('maps a scored publisher PQSRecord to the PQS shape (BPS)', async () => {
    const spy = mockFetch(200, {
      publisher: PUB.toLowerCase(),
      dispute_score: 9800,
      retention_score: 7500,
      freshness_score: 10000,
      revenue_quality: 6200,
      composite: 8425,
      computed_at: '2026-06-14T00:00:00Z',
    });

    const pqs = await getPQS(PUB, INDEXER);

    expect(pqs.composite).toBe(8425);
    expect(pqs.dispute).toBe(9800);
    expect(pqs.retention).toBe(7500);
    expect(pqs.freshness).toBe(10000);
    expect(pqs.revenueQuality).toBe(6200);
    expect(pqs.asOf).toBe('2026-06-14T00:00:00Z');

    // Lowercases the address into the path.
    const url = spy.mock.calls[0][0] as string;
    expect(url).toBe(`${INDEXER}/publisher/${PUB.toLowerCase()}/pqs`);
  });

  it('returns composite=null for an unscored publisher (404)', async () => {
    mockFetch(404);
    const pqs = await getPQS(PUB, INDEXER);
    expect(pqs.composite).toBeNull();
    expect(pqs.dispute).toBeUndefined();
  });

  it('throws on a server error (distinguishes unreachable from unscored)', async () => {
    mockFetch(500);
    await expect(getPQS(PUB, INDEXER)).rejects.toThrow(/500/);
  });

  it('throws on an empty indexerUrl', async () => {
    await expect(getPQS(PUB, '')).rejects.toThrow(/indexerUrl/);
  });
});
