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

/**
 * Thrown by fetchAndVerify when a JSON-envelope payload matches the attested
 * hash under NO known canonical form (raw response bytes, sorted-canonical,
 * insertion-order). Deliberately NOT a HashMismatchError: once a payload has
 * been re-serialized, a hash mismatch cannot distinguish tampering from a
 * canonical-form difference, so this error alleges neither — it tells you to
 * fetch the exact delivered bytes and use verifyPayload() (byte-exact), which
 * is the only path that can prove tampering. Fail closed either way: do not
 * consume the payload.
 *
 * Background: two canonical-JSON forms exist in this stack. The SDK publishers
 * hash SORTED-key canonical bytes (canonical.ts); the first-party live feeds
 * sign INSERTION-ORDER compact bytes (a frozen hash-compatibility surface).
 * See ops/plans/TICKET_CANONICAL_FORMS_2026-07-03.md.
 */
export class CanonicalFormMismatchError extends Error {
  constructor(
    public readonly expected: Hex,
    public readonly candidates: Readonly<Record<string, Hex>>,
  ) {
    super(
      `payload matched the attested hash ${expected} under no known canonical form (` +
        Object.entries(candidates)
          .map(([form, h]) => `${form}=${h}`)
          .join(', ') +
        `). A re-serialized JSON envelope cannot distinguish tampering from a ` +
        `canonical-form mismatch — fetch the exact delivered bytes and verify them ` +
        `with verifyPayload() (byte-exact). Do not consume this payload.`,
    );
    this.name = 'CanonicalFormMismatchError';
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
  const base = discoveryUrl.replace(/\/$/, '');
  // discovery-api's route is GET /payload/:hash (singular — discovery-api
  // src/index.ts:222). Earlier SDK versions fetched /payloads/<hash>, which
  // that API never served; keep it as a fallback for archives that adopted
  // the old SDK convention.
  let res = await fetch(`${base}/payload/${hashHex}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) {
    res = await fetch(`${base}/payloads/${hashHex}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
  if (res.status === 404) {
    throw new Error(`archive miss for payload ${hashHex}`);
  }
  if (!res.ok) {
    throw new Error(`archive fetch failed: ${res.status} ${res.statusText}`);
  }

  // discovery-api wraps payloads as { payload: {...}, ... }. TWO publisher
  // populations hash DIFFERENT bytes for the same logical payload:
  //   - SDK publishers (publisher.ts / publisher.py): SORTED-key canonical form.
  //   - First-party live feeds (data-feeds/*/server.py): INSERTION-ORDER compact
  //     form — a FROZEN hash-compatibility surface (never re-sort it).
  // A re-serialized envelope therefore has to be tried against every known
  // form; a keccak256 match under ANY form proves those bytes are the attested
  // preimage. If NONE match we throw CanonicalFormMismatchError — NOT
  // HashMismatchError, because after re-serialization a mismatch cannot
  // distinguish tampering from a form difference. This envelope re-wrap is the
  // ONLY place the SDK re-serializes; verifyPayload itself hashes whatever raw
  // bytes it gets (byte-exact, real tamper semantics).
  // Known residual gap (documented, fail-closed): the insertion-order candidate
  // re-derives via JSON.parse → JSON.stringify, which preserves key order but
  // NOT Python's ensure_ascii \uXXXX escapes or float repr — such payloads fall
  // through to CanonicalFormMismatchError and must be verified byte-exact.
  const buf = new Uint8Array(await res.arrayBuffer());
  let payloadValue: unknown;
  let isEnvelope = false;
  try {
    const text = new TextDecoder().decode(buf);
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && 'payload' in obj) {
      isEnvelope = true;
      payloadValue = (obj as Record<string, unknown>).payload;
    }
  } catch {
    // not JSON — raw-bytes archive; byte-exact path below
  }

  if (!isEnvelope) {
    verifyPayload(buf, payloadHash); // byte-exact: HashMismatchError = real tamper signal
    return buf;
  }

  const expected = normalizeHash(payloadHash);
  const candidates: Array<[string, Uint8Array]> = [
    ['raw-response', buf],
    ['sorted-canonical', canonicalBytes(payloadValue)],
    ['insertion-order', new TextEncoder().encode(JSON.stringify(payloadValue))],
  ];
  const seen: Record<string, Hex> = {};
  for (const [form, bytes] of candidates) {
    const h = keccak256(toHex(bytes)).toLowerCase() as Hex;
    seen[form] = h;
    if (h === expected) return bytes; // attested preimage found
  }
  throw new CanonicalFormMismatchError(expected, seen);
}
