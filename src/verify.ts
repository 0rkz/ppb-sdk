/**
 * Subscriber-side hash verification for BYTE Library r2 payloads.
 *
 * THIS IS THE POST-MORTEM-DEFENSIBILITY WEDGE FOR BYTE LIBRARY v1.
 *
 * The on-chain DataStreamed / BroadcastStreamed event certifies that the
 * publisher SIGNED an EIP-712 attestation over
 * (publisher, payloadHash, payloadLength, deadline). That proves the
 * publisher attested *to a payload with the given hash* — but it does
 * NOT prove the bytes you received in your delivery channel match.
 *
 * A corrupted archive, a man-in-the-middle on the off-chain transport,
 * or a publisher misconfig could feed you different bytes while the
 * on-chain attestation still verifies (because the hash in the event
 * is what the publisher signed for, not necessarily what you received).
 *
 * `verifyPayload()` closes that gap. Call it on every payload before
 * acting on the data. If it throws `HashMismatchError`, the bytes you
 * received do NOT match what the publisher attested to on-chain — do
 * not consume them; treat it as a publisher-side or transport incident.
 *
 * This is the function a risk committee can point at in a post-mortem:
 * "every byte we relied on was hash-verified against the publisher's
 * on-chain attestation; here is the tx hash and here is the verifier."
 */

import { keccak256, toHex, type Hex } from 'viem';
import { canonicalBytes } from './canonical';

export class HashMismatchError extends Error {
  constructor(
    public readonly expected: Hex,
    public readonly actual: Hex,
  ) {
    super(`payload hash mismatch: expected ${expected}, got ${actual}`);
    this.name = 'HashMismatchError';
  }
}

function normalizeHash(h: Hex | string): Hex {
  const lower = h.toLowerCase();
  return (lower.startsWith('0x') ? lower : `0x${lower}`) as Hex;
}

/**
 * Verify keccak256(payloadBytes) matches the on-chain attested hash.
 * Throws HashMismatchError on mismatch.
 *
 * Usage:
 *   import { verifyPayload, HashMismatchError } from '@payperbyte/sdk';
 *
 *   for await (const event of subscriber.stream()) {
 *     const bytes = await fetchFromMyArchive(event.payloadHash);
 *     try {
 *       verifyPayload(bytes, event.payloadHash);
 *     } catch (e) {
 *       if (e instanceof HashMismatchError) {
 *         logIncident(e);
 *         continue; // do NOT consume mismatched bytes
 *       }
 *       throw e;
 *     }
 *     consume(bytes);
 *   }
 */
export function verifyPayload(
  payloadBytes: Uint8Array | Hex | string,
  expectedHash: Hex | string,
): void {
  const data =
    typeof payloadBytes === 'string'
      ? (payloadBytes.startsWith('0x')
          ? (payloadBytes as Hex)
          : toHex(new TextEncoder().encode(payloadBytes)))
      : toHex(payloadBytes);
  const actual = keccak256(data).toLowerCase() as Hex;
  const expected = normalizeHash(expectedHash);
  if (actual !== expected) {
    throw new HashMismatchError(expected, actual);
  }
}

/**
 * Fetch a payload from a discovery-api-style archive and verify its
 * hash against the on-chain attested hash. Returns the raw bytes on
 * success.
 *
 * Throws HashMismatchError if the archive's bytes don't match the
 * attestation. Throws Error("archive miss …") on 404.
 *
 * Convenience wrapper around verifyPayload. If your archive lives
 * elsewhere or uses a non-standard envelope, fetch the bytes yourself
 * and call verifyPayload directly.
 */
/**
 * Verify a payload against a stream event's attestation, but ONLY if the
 * event carries an r2 attestation. Legacy pre-r2 events have no attestation
 * field; for those this is a no-op returning false so the caller can decide
 * policy (fail-closed vs. allow legacy).
 *
 * Returns true if the attestation was present and bytes verified.
 * Throws HashMismatchError if attestation present and bytes don't match.
 */
export function verifyEventPayload(
  event: {
    payloadHash: Hex | string;
    attestation?: Hex | Uint8Array | null;
  },
  payloadBytes: Uint8Array | Hex | string,
): boolean {
  const att = event.attestation;
  const hasAtt =
    att !== null &&
    att !== undefined &&
    !(typeof att === 'string' && (att as string).length <= 2) &&
    !(att instanceof Uint8Array && att.byteLength === 0);
  if (!hasAtt) return false;
  verifyPayload(payloadBytes, event.payloadHash);
  return true;
}

export async function fetchAndVerify(
  payloadHash: Hex | string,
  discoveryUrl: string,
  timeoutMs = 3_000,
): Promise<Uint8Array> {
  const hashHex = normalizeHash(payloadHash).slice(2);
  const url = `${discoveryUrl.replace(/\/$/, '')}/payloads/${hashHex}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 404) {
    throw new Error(`archive miss for payload ${hashHex}`);
  }
  if (!res.ok) {
    throw new Error(`archive fetch failed: ${res.status} ${res.statusText}`);
  }

  // discovery-api wraps payloads as { payload: {...}, ... }. The publisher
  // hashed the CANONICAL envelope-payload bytes (recursively key-sorted, no
  // whitespace) — re-serialize through the SAME canonical helper the publish
  // side uses so keccak256 matches. This envelope re-wrap is the ONLY place the
  // SDK re-serializes; verifyPayload itself hashes whatever raw bytes it gets.
  // For raw-bytes archives, fall through to the raw response.
  const buf = new Uint8Array(await res.arrayBuffer());
  let canonical: Uint8Array;
  try {
    const text = new TextDecoder().decode(buf);
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && 'payload' in obj) {
      canonical = canonicalBytes(obj.payload);
    } else {
      canonical = buf;
    }
  } catch {
    canonical = buf;
  }

  verifyPayload(canonical, payloadHash);
  return canonical;
}
