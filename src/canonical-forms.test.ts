/**
 * Cross-canonical-form boundary tests — ops/plans/TICKET_CANONICAL_FORMS_2026-07-03.md.
 *
 * Documents the two canonical-JSON forms in the stack (SDK sorted vs live-feed
 * insertion-order), proves byte-exact verification is form-agnostic, and pins
 * the fetchAndVerify contract: a keccak match under ANY known form verifies;
 * no match on a re-serialized envelope throws CanonicalFormMismatchError
 * (loud, correct) — never a false HashMismatchError tamper alarm. Raw-bytes
 * paths keep real tamper semantics.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import { canonicalBytes } from './canonical';
import {
  CanonicalFormMismatchError,
  HashMismatchError,
  fetchAndVerify,
  verifyPayload,
} from './verify';

// Insertion order deliberately NOT sorted ("b" before "a").
const PAYLOAD = { b: 1, a: { d: 2, c: 3 }, list: [{ z: 9, y: 8 }] };

/** The live feeds' form: compact JSON in insertion order (data-feeds feed servers). */
function insertionOrderBytes(v: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(v));
}

function hashOf(bytes: Uint8Array): Hex {
  return keccak256(toHex(bytes)).toLowerCase() as Hex;
}

function mockArchive(body: string | Uint8Array): void {
  const buf = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array(buf).slice().buffer, { status: 200 })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('the two canonical forms diverge (the documented boundary)', () => {
  it('insertion-order bytes and sorted-canonical bytes hash differently for the same payload', () => {
    const insertion = insertionOrderBytes(PAYLOAD);
    const sorted = canonicalBytes(PAYLOAD);
    expect(new TextDecoder().decode(insertion)).not.toEqual(new TextDecoder().decode(sorted));
    expect(hashOf(insertion)).not.toEqual(hashOf(sorted));
  });

  it('already-sorted payloads coincide across forms (why the bug hid)', () => {
    const alreadySorted = { a: 1, b: 2 };
    expect(hashOf(insertionOrderBytes(alreadySorted))).toEqual(hashOf(canonicalBytes(alreadySorted)));
  });
});

describe('byte-exact verification is form-agnostic', () => {
  it('verifyPayload passes on delivered insertion-order bytes against their own hash', () => {
    const bytes = insertionOrderBytes(PAYLOAD);
    expect(() => verifyPayload(bytes, hashOf(bytes))).not.toThrow();
  });

  it('verifyPayload still throws HashMismatchError on genuinely different bytes', () => {
    const bytes = insertionOrderBytes(PAYLOAD);
    const tampered = insertionOrderBytes({ ...PAYLOAD, b: 2 });
    expect(() => verifyPayload(tampered, hashOf(bytes))).toThrow(HashMismatchError);
  });
});

describe('fetchAndVerify is form-aware', () => {
  const url = 'https://archive.example';

  it('verifies an envelope whose payload was hashed in INSERTION order (live-feed form)', async () => {
    const attested = hashOf(insertionOrderBytes(PAYLOAD));
    mockArchive(JSON.stringify({ payload: PAYLOAD, meta: 'x' }));
    const bytes = await fetchAndVerify(attested, url);
    expect(hashOf(bytes)).toEqual(attested);
  });

  it('verifies an envelope whose payload was hashed in SORTED form (SDK-publisher form)', async () => {
    const attested = hashOf(canonicalBytes(PAYLOAD));
    mockArchive(JSON.stringify({ payload: PAYLOAD, meta: 'x' }));
    const bytes = await fetchAndVerify(attested, url);
    expect(hashOf(bytes)).toEqual(attested);
  });

  it('verifies a raw-bytes archive byte-exactly', async () => {
    const delivered = insertionOrderBytes(PAYLOAD);
    mockArchive(delivered);
    const bytes = await fetchAndVerify(hashOf(delivered), url);
    expect(bytes).toEqual(delivered);
  });

  it('throws CanonicalFormMismatchError — NOT HashMismatchError — when no form matches a re-serialized envelope', async () => {
    // Attested hash belongs to bytes no re-serialization of this envelope can
    // reproduce (e.g. the original had Python \uXXXX escaping or was tampered
    // in the archive — indistinguishable after re-serialization, so no tamper claim).
    const attested = hashOf(new TextEncoder().encode('unreachable-preimage'));
    mockArchive(JSON.stringify({ payload: PAYLOAD }));
    const err = await fetchAndVerify(attested, url).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CanonicalFormMismatchError);
    expect(err).not.toBeInstanceOf(HashMismatchError);
    const cfm = err as CanonicalFormMismatchError;
    expect(Object.keys(cfm.candidates).sort()).toEqual([
      'insertion-order',
      'raw-response',
      'sorted-canonical',
    ]);
    expect(cfm.message).toContain('verifyPayload');
    expect(cfm.message).toContain('Do not consume');
  });

  it('keeps real tamper semantics (HashMismatchError) on a raw-bytes archive', async () => {
    const delivered = new TextEncoder().encode('not-json-raw-bytes');
    mockArchive(delivered);
    const attestedOfOtherBytes = hashOf(new TextEncoder().encode('the-real-bytes'));
    await expect(fetchAndVerify(attestedOfOtherBytes, url)).rejects.toBeInstanceOf(
      HashMismatchError,
    );
  });

  it('hits /payload/ (singular, the discovery-api route) first and falls back to /payloads/', async () => {
    const delivered = insertionOrderBytes(PAYLOAD);
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        calls.push(u);
        // singular route 404s in this archive; plural serves the payload
        if (u.includes('/payload/')) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(delivered).slice().buffer, { status: 200 });
      }),
    );
    await fetchAndVerify(hashOf(delivered), url);
    expect(calls[0]).toContain('/payload/');
    expect(calls[1]).toContain('/payloads/');
  });
});
