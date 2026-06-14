/**
 * Trust Kit — the verify-before-act provenance primitives for the BYTE Library.
 *
 * The on-chain `BroadcastStreamed` / `DataStreamed` event (and the gateway's
 * `X-BYTE-Attestation` response header) carry an EIP-712 PayloadAttestation: the
 * publisher SIGNED over (publisher, payloadHash, payloadLength, deadline). That
 * proves *the publisher attested to a payload with the given hash* — but two
 * things must hold before an agent acts on bytes it received over an untrusted
 * transport (archive, gateway, MITM-able channel):
 *
 *   1. HASH leg     — keccak256(receivedBytes) == the attested payloadHash.
 *   2. SIGNER leg   — recoverTypedDataAddress(...) == the publisher the catalog/
 *                     registry says it is.
 *
 * The shipped SDK's `verifyPayload()` only does leg 1 (hash). This module adds
 * the MISSING leg 2 (signer recovery) and composes both into a single `Verdict`,
 * plus hoists the previously-private signing logic into a standalone
 * `signAttestation()`.
 *
 * CONSENSUS-CRITICAL: the EIP-712 domain literal `name: 'BYTE Library'` (version
 * '1', chainId, verifyingContract: dataStream) is the signing constant shared,
 * byte-identical, across the on-chain DataStreamLib verifier, the gateway
 * producer, the MCP verifier, and this SDK. It is NEVER renamed — a different
 * name produces a different digest and breaks every existing verifier and every
 * emitted settlement receipt. It is the signing constant, not a brand.
 */

import {
  keccak256,
  toHex,
  getAddress,
  recoverTypedDataAddress,
  type Hex,
} from 'viem';
import type { NetworkConfig } from './client';

/**
 * EIP-712 PayloadAttestation type definition. Must match
 * DataStreamLib.PAYLOAD_ATTESTATION_TYPEHASH literally:
 *   PayloadAttestation(address publisher,bytes32 payloadHash,uint256 payloadLength,uint256 deadline)
 */
export const PAYLOAD_ATTESTATION_TYPES = {
  PayloadAttestation: [
    { name: 'publisher', type: 'address' },
    { name: 'payloadHash', type: 'bytes32' },
    { name: 'payloadLength', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/**
 * The EIP-712 domain for the PayloadAttestation. `name` is CONSENSUS-CRITICAL —
 * NEVER change it. It is identical across the contract, gateway, MCP, and SDK.
 */
export function attestationDomain(net: NetworkConfig) {
  return {
    name: 'BYTE Library',
    version: '1',
    chainId: net.chainId,
    verifyingContract: net.contracts.dataStream,
  } as const;
}

/** The four fields the publisher signs over. */
export interface PayloadAttestationStruct {
  publisher: Hex;
  payloadHash: Hex;
  payloadLength: bigint;
  deadline: bigint;
}

/** A viem WalletClient / Account — anything that can EIP-712 sign. */
export interface TypedDataSigner {
  signTypedData: (args: any) => Promise<Hex>;
  account?: { address: Hex } | Hex;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Normalize arbitrary payload input into the exact bytes-hex fed to keccak256. */
function toBytesHex(payloadBytes: Uint8Array | Hex | string): Hex {
  if (typeof payloadBytes === 'string') {
    return payloadBytes.startsWith('0x')
      ? (payloadBytes as Hex)
      : toHex(new TextEncoder().encode(payloadBytes));
  }
  return toHex(payloadBytes);
}

function normalizeHash(h: Hex | string): Hex {
  const lower = h.toLowerCase();
  return (lower.startsWith('0x') ? lower : `0x${lower}`) as Hex;
}

/** An attestation is "present" only if it is a non-empty hex string (len > 2). */
function hasAttestation(att: Hex | null | undefined): att is Hex {
  return (
    att !== null &&
    att !== undefined &&
    typeof att === 'string' &&
    att.length > 2
  );
}

// ─── 1. signAttestation() — hoisted from the private Publisher.signAttestation ──

/**
 * Sign an EIP-712 PayloadAttestation for the active chain + DataStream contract.
 * Returns the 65-byte signature hex which the contract verifies before settling
 * and which subscribers re-verify out-of-band via {@link verifyAttestation}.
 *
 * This is the standalone export of what was `Publisher.signAttestation`. The
 * signer is any viem WalletClient/Account exposing `signTypedData`. The
 * `att.publisher` is the address that will be encoded into the signed message —
 * it MUST be the signer's own address for the recovered signer to match.
 *
 * PAY_TO-class defense: refuses to sign against an unset/zero DataStream address,
 * which would otherwise revert `InvalidAttestationSignature` on the live r2
 * contract with no useful error trail.
 */
export async function signAttestation(
  att: PayloadAttestationStruct,
  signer: TypedDataSigner,
  net: NetworkConfig,
): Promise<Hex> {
  const ds = (net.contracts.dataStream || '').toLowerCase();
  if (!ds || ds === ZERO_ADDRESS) {
    throw new Error(
      'signAttestation: network.contracts.dataStream is unset or zero-address — ' +
        'refusing to sign with a placeholder.',
    );
  }
  const account =
    typeof signer.account === 'string'
      ? signer.account
      : signer.account;
  return signer.signTypedData({
    ...(account ? { account } : {}),
    domain: attestationDomain(net),
    types: PAYLOAD_ATTESTATION_TYPES,
    primaryType: 'PayloadAttestation',
    message: {
      publisher: att.publisher,
      payloadHash: att.payloadHash,
      payloadLength: att.payloadLength,
      deadline: att.deadline,
    },
  });
}

// ─── 2. verifyAttestation() — the MISSING half: hash + signer recovery ─────────

/**
 * The verify-before-act verdict. `verified` is the AND of the hash leg and the
 * signer leg; everything else is the evidence that produced it (for logs /
 * post-mortems). See {@link verifyAttestation} for the per-field rules.
 */
export interface Verdict {
  /** hashMatch && signerMatch === true. The single "safe to act?" boolean. */
  verified: boolean;
  /** keccak256(payloadBytes) === payloadHash. */
  hashMatch: boolean;
  /**
   * recovered === expectedPublisher. `null` means there was no attestation to
   * check (empty/missing) — fail-closed, never "pass on hash alone".
   */
  signerMatch: boolean | null;
  /** The recovered EIP-712 signer address (checksummed), or null. */
  recovered: Hex | null;
  /** deadline < now. ADVISORY ONLY — does NOT fail `verified`. See rule 4. */
  expired: boolean;
  /** Human-readable verdict for logs / post-mortem. */
  reason: string;
}

export interface VerifyAttestationArgs {
  /** The bytes the agent is about to act on. */
  payloadBytes: Uint8Array | Hex | string;
  /** The 65-byte signature (on-chain BroadcastStreamed OR X-BYTE-Attestation). */
  attestation: Hex | null;
  /** Who the catalog / registry says the publisher is. */
  expectedPublisher: Hex;
  /** The attested payload hash. */
  payloadHash: Hex;
  /** The attested payload length. */
  payloadLength: bigint;
  /** The attested deadline (unix seconds). */
  deadline: bigint;
  net: NetworkConfig;
  /** Override "now" (unix seconds) — for deterministic tests. Defaults to Date.now(). */
  nowSeconds?: bigint;
}

/**
 * Verify both legs of a PayloadAttestation: the received bytes hash to the
 * attested hash AND the attestation signature recovers to the expected
 * publisher.
 *
 * Edge cases (these ARE the spec — see PHASE0_TRUST_KIT_SDK_SPEC §"Behavior"):
 *  - Tampered bytes        → hashMatch=false, verified=false.
 *  - Wrong/forged signer   → signerMatch=false, verified=false.
 *  - Empty/missing att     → signerMatch=null, verified=false (FAIL-CLOSED; we
 *                            do NOT pass on the hash alone).
 *  - Expired deadline      → expired=true, but verified is UNAFFECTED. A
 *                            once-minted `now+300s` deadline makes every aged
 *                            feed "expired"; staleness is a freshness axis, not
 *                            a provenance verdict. Surface it; let the caller
 *                            decide policy.
 *
 * Throws nothing — always returns a Verdict (recovery failures become
 * signerMatch=false rather than exceptions).
 */
export async function verifyAttestation(
  args: VerifyAttestationArgs,
): Promise<Verdict> {
  const now =
    args.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  const expired = args.deadline < now;

  // ── HASH leg ──
  const recomputed = keccak256(toBytesHex(args.payloadBytes)).toLowerCase() as Hex;
  const expectedHash = normalizeHash(args.payloadHash);
  const hashMatch = recomputed === expectedHash;

  // ── Empty / missing attestation → FAIL-CLOSED (do not pass on hash alone) ──
  if (!hasAttestation(args.attestation)) {
    return {
      verified: false,
      hashMatch,
      signerMatch: null,
      recovered: null,
      expired,
      reason: hashMatch
        ? 'no attestation signature to verify — fail-closed (the bytes hash-match, ' +
          'but provenance is unproven without the publisher signature)'
        : 'no attestation signature, and the bytes do not match the attested hash — fail-closed',
    };
  }

  // ── SIGNER leg ──
  let recovered: Hex | null = null;
  let signerMatch = false;
  try {
    const signer = await recoverTypedDataAddress({
      domain: attestationDomain(args.net),
      types: PAYLOAD_ATTESTATION_TYPES,
      primaryType: 'PayloadAttestation',
      message: {
        publisher: args.expectedPublisher,
        payloadHash: args.payloadHash,
        payloadLength: args.payloadLength,
        deadline: args.deadline,
      },
      signature: args.attestation,
    });
    recovered = getAddress(signer);
    signerMatch = recovered.toLowerCase() === args.expectedPublisher.toLowerCase();
  } catch (e) {
    // Malformed signature / bad recovery → treat as a signer mismatch, not a throw.
    recovered = null;
    signerMatch = false;
  }

  const verified = hashMatch && signerMatch;
  return {
    verified,
    hashMatch,
    signerMatch,
    recovered,
    expired,
    reason: verified
      ? 'received bytes hash-match the attested hash AND the attestation recovers to ' +
        'the named publisher — safe to act' +
        (expired ? ' (note: deadline elapsed; advisory only, provenance is immutable)' : '')
      : !hashMatch
        ? 'HASH MISMATCH — the received bytes are NOT what the publisher attested; do not act'
        : 'attestation signature did not recover to the named publisher; do not act',
  };
}

// ─── 3. verify() — the headline verify-before-act call (composes 1+2) ──────────

/**
 * Input to the convenience {@link verify}. Either supply the fully-resolved
 * attestation fields directly (same as verifyAttestation) — this is the lowest
 * common denominator. For the two anchor types (on-chain event / gateway
 * header) use {@link verifyFromEvent} / {@link verifyFromGatewayResponse}.
 */
export type VerifyInput = VerifyAttestationArgs;

/**
 * The headline verify-before-act call. Today this composes the hash + signer
 * legs from explicit fields; the {@link verifyFromEvent} and
 * {@link verifyFromGatewayResponse} wrappers adapt the two on-the-wire anchor
 * shapes into this call. Throws nothing; returns a Verdict.
 */
export function verify(input: VerifyInput): Promise<Verdict> {
  return verifyAttestation(input);
}

// ─── Anchor adapters — same EIP-712 domain, two transports ─────────────────────

/**
 * A BYTE Library r2 settlement event (on-chain anchor). Shape matches the
 * `BroadcastStreamed` / stream `StreamMessage` decode: the attestation is the
 * publisher's signature, the publisher is `event.publisher`.
 */
export interface AttestedEvent {
  publisher: Hex;
  payloadHash: Hex;
  payloadLength: bigint | number;
  /** From `attestationDeadline` on the r2 event. */
  attestationDeadline?: bigint | number;
  deadline?: bigint | number;
  /** The 65-byte signature emitted in the event. */
  attestation?: Hex | null;
}

/**
 * Verify a payload against an on-chain settlement event. The publisher named in
 * the event IS the expected signer (the event is authoritative for who attested).
 */
export function verifyFromEvent(
  event: AttestedEvent,
  payloadBytes: Uint8Array | Hex | string,
  net: NetworkConfig,
  nowSeconds?: bigint,
): Promise<Verdict> {
  const deadline =
    event.attestationDeadline ?? event.deadline ?? 0n;
  return verifyAttestation({
    payloadBytes,
    attestation: event.attestation ?? null,
    expectedPublisher: event.publisher,
    payloadHash: event.payloadHash,
    payloadLength: BigInt(event.payloadLength),
    deadline: BigInt(deadline),
    net,
    nowSeconds,
  });
}

/**
 * The JSON parsed from the gateway's `X-BYTE-Attestation` response header —
 * mirrors x402-gateway/src/lib/attestation.ts `ByteAttestation`. The gateway
 * signs the EXACT response bytes under the SAME EIP-712 domain, so a buyer
 * recomputes keccak256(body) and recovers the signer with this same verifier.
 */
export interface GatewayByteAttestation {
  alg?: string;
  domain?: { name: string; version: string; chainId: number; verifyingContract: Hex };
  publisher: Hex;
  payloadHash: Hex;
  payloadLength: number | bigint;
  deadline: number | bigint;
  signature: Hex;
}

/**
 * Verify a gateway response: parse the `X-BYTE-Attestation` header, then verify
 * the body bytes hash + recover the gateway attester. The gateway publishes the
 * attester address out-of-band (agent card / well-known); pass it as
 * `expectedAttester` so a forged header can't self-certify. If omitted, the
 * header's own `publisher` is trusted (signer-match degrades to "internally
 * consistent" — only the hash leg is adversarially meaningful, so prefer
 * passing the known attester).
 *
 * @param responseBody  the EXACT bytes the gateway returned (string or bytes).
 * @param attestationHeader  the raw `X-BYTE-Attestation` header value (JSON), or
 *                           the already-parsed object, or null if absent.
 */
export function verifyFromGatewayResponse(
  responseBody: Uint8Array | Hex | string,
  attestationHeader: string | GatewayByteAttestation | null,
  net: NetworkConfig,
  expectedAttester?: Hex,
  nowSeconds?: bigint,
): Promise<Verdict> {
  let att: GatewayByteAttestation | null = null;
  if (attestationHeader) {
    att =
      typeof attestationHeader === 'string'
        ? safeParseAttestation(attestationHeader)
        : attestationHeader;
  }
  if (!att) {
    // Missing / unparseable header → fail-closed via the empty-attestation rule.
    return verifyAttestation({
      payloadBytes: responseBody,
      attestation: null,
      expectedPublisher: expectedAttester ?? (ZERO_ADDRESS as Hex),
      payloadHash: keccak256(toBytesHex(responseBody)),
      payloadLength: byteLengthOf(responseBody),
      deadline: 0n,
      net,
      nowSeconds,
    });
  }
  return verifyAttestation({
    payloadBytes: responseBody,
    attestation: att.signature ?? null,
    expectedPublisher: expectedAttester ?? att.publisher,
    payloadHash: att.payloadHash,
    payloadLength: BigInt(att.payloadLength),
    deadline: BigInt(att.deadline),
    net,
    nowSeconds,
  });
}

function safeParseAttestation(raw: string): GatewayByteAttestation | null {
  try {
    return JSON.parse(raw) as GatewayByteAttestation;
  } catch {
    return null;
  }
}

function byteLengthOf(payloadBytes: Uint8Array | Hex | string): bigint {
  if (typeof payloadBytes === 'string') {
    return payloadBytes.startsWith('0x')
      ? BigInt((payloadBytes.length - 2) / 2)
      : BigInt(new TextEncoder().encode(payloadBytes).length);
  }
  return BigInt(payloadBytes.length);
}
