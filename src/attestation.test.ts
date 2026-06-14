/**
 * Trust Kit acceptance-criteria tests (PHASE0_TRUST_KIT_SDK_SPEC §"Acceptance").
 *
 * Proves the sign + verify round-trip and every planted-fault verdict:
 *  - known-good signed payload → verified=true, recovered == publisher
 *  - flip one byte           → hashMatch=false, verified=false
 *  - re-sign with wrong key   → signerMatch=false, verified=false
 *  - stripped attestation     → signerMatch=null, verified=false (fail-closed)
 *  - aged deadline            → expired=true, verified UNAFFECTED on the anchor
 *  - sign↔verify round-trip   → signAttestation output verifies
 */

import { describe, it, expect } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { canonicalBytes } from './canonical';
import {
  signAttestation,
  verifyAttestation,
  verify,
  verifyFromEvent,
  verifyFromGatewayResponse,
  attestationDomain,
  type PayloadAttestationStruct,
} from './attestation';
import { ARBITRUM_SEPOLIA } from './networks';

const NET = ARBITRUM_SEPOLIA;

// Deterministic test keys (anvil well-known #0 and #1).
const KEY_A = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const KEY_B = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const ACCOUNT_A = privateKeyToAccount(KEY_A);
const ACCOUNT_B = privateKeyToAccount(KEY_B);

// A representative live-shaped payload (weather feed style).
const PAYLOAD = {
  feed: 'weather',
  station: 'KSFO',
  temp_c: 14,
  observed_at: '2026-06-14T00:00:00Z',
};

/** Build a fully-signed attestation over the canonical payload bytes. */
async function buildSigned(opts: {
  signer?: typeof ACCOUNT_A;
  publisher?: Hex;
  ttlSeconds?: number;
  payload?: unknown;
} = {}) {
  const signer = opts.signer ?? ACCOUNT_A;
  const publisher = opts.publisher ?? (signer.address as Hex);
  const bytes = canonicalBytes(opts.payload ?? PAYLOAD);
  const payloadHash = keccak256(toHex(bytes));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 300));
  const att: PayloadAttestationStruct = {
    publisher,
    payloadHash,
    payloadLength: BigInt(bytes.length),
    deadline,
  };
  const signature = await signAttestation(
    att,
    { account: signer, signTypedData: (a: any) => signer.signTypedData(a) },
    NET,
  );
  return { bytes, payloadHash, deadline, signature, publisher: publisher, att };
}

describe('attestationDomain', () => {
  it('is the consensus-critical BYTE Library domain bound to dataStream', () => {
    const d = attestationDomain(NET);
    expect(d.name).toBe('BYTE Library'); // NEVER rename — consensus-critical
    expect(d.version).toBe('1');
    expect(d.chainId).toBe(NET.chainId);
    expect(d.verifyingContract).toBe(NET.contracts.dataStream);
  });
});

describe('sign ↔ verify round-trip', () => {
  it('signAttestation output verifies under verifyAttestation', async () => {
    const s = await buildSigned();
    const v = await verifyAttestation({
      payloadBytes: s.bytes,
      attestation: s.signature,
      expectedPublisher: s.publisher,
      payloadHash: s.payloadHash,
      payloadLength: BigInt(s.bytes.length),
      deadline: s.deadline,
      net: NET,
    });
    expect(v.verified).toBe(true);
    expect(v.hashMatch).toBe(true);
    expect(v.signerMatch).toBe(true);
    expect(v.recovered?.toLowerCase()).toBe(ACCOUNT_A.address.toLowerCase());
    expect(v.expired).toBe(false);
  });

  it('verify() composes the same legs', async () => {
    const s = await buildSigned();
    const v = await verify({
      payloadBytes: s.bytes,
      attestation: s.signature,
      expectedPublisher: s.publisher,
      payloadHash: s.payloadHash,
      payloadLength: BigInt(s.bytes.length),
      deadline: s.deadline,
      net: NET,
    });
    expect(v.verified).toBe(true);
  });
});

describe('planted faults', () => {
  it('tampered byte → hashMatch=false, verified=false', async () => {
    const s = await buildSigned();
    const tampered = new Uint8Array(s.bytes);
    tampered[0] = tampered[0] ^ 0xff; // flip one byte
    const v = await verifyAttestation({
      payloadBytes: tampered,
      attestation: s.signature,
      expectedPublisher: s.publisher,
      payloadHash: s.payloadHash, // still the ORIGINAL attested hash
      payloadLength: BigInt(s.bytes.length),
      deadline: s.deadline,
      net: NET,
    });
    expect(v.hashMatch).toBe(false);
    expect(v.verified).toBe(false);
    expect(v.reason).toMatch(/HASH MISMATCH/);
  });

  it('wrong key (signer != expectedPublisher) → signerMatch=false, verified=false', async () => {
    // Sign with B, but tell verify the publisher is A.
    const s = await buildSigned({ signer: ACCOUNT_B, publisher: ACCOUNT_A.address as Hex });
    const v = await verifyAttestation({
      payloadBytes: s.bytes,
      attestation: s.signature,
      expectedPublisher: ACCOUNT_A.address as Hex,
      payloadHash: s.payloadHash,
      payloadLength: BigInt(s.bytes.length),
      deadline: s.deadline,
      net: NET,
    });
    expect(v.hashMatch).toBe(true);
    expect(v.signerMatch).toBe(false);
    expect(v.verified).toBe(false);
    // recovered is B (or null on a malformed recover), but never A.
    expect(v.recovered?.toLowerCase()).not.toBe(ACCOUNT_A.address.toLowerCase());
  });

  it('stripped attestation (null) → signerMatch=null, verified=false (fail-closed)', async () => {
    const s = await buildSigned();
    const v = await verifyAttestation({
      payloadBytes: s.bytes,
      attestation: null,
      expectedPublisher: s.publisher,
      payloadHash: s.payloadHash,
      payloadLength: BigInt(s.bytes.length),
      deadline: s.deadline,
      net: NET,
    });
    expect(v.signerMatch).toBeNull();
    expect(v.verified).toBe(false); // FAIL-CLOSED — not "pass on hash alone"
    expect(v.recovered).toBeNull();
  });

  it('empty attestation ("0x", len<=2) → signerMatch=null, verified=false', async () => {
    const s = await buildSigned();
    const v = await verifyAttestation({
      payloadBytes: s.bytes,
      attestation: '0x' as Hex,
      expectedPublisher: s.publisher,
      payloadHash: s.payloadHash,
      payloadLength: BigInt(s.bytes.length),
      deadline: s.deadline,
      net: NET,
    });
    expect(v.signerMatch).toBeNull();
    expect(v.verified).toBe(false);
  });

  it('malformed signature → signerMatch=false (no throw)', async () => {
    const s = await buildSigned();
    const v = await verifyAttestation({
      payloadBytes: s.bytes,
      attestation: '0xdeadbeef' as Hex, // not a 65-byte sig
      expectedPublisher: s.publisher,
      payloadHash: s.payloadHash,
      payloadLength: BigInt(s.bytes.length),
      deadline: s.deadline,
      net: NET,
    });
    expect(v.signerMatch).toBe(false);
    expect(v.verified).toBe(false);
  });
});

describe('expired deadline rule (DQI-P2)', () => {
  it('aged deadline → expired=true but verified UNAFFECTED on the immutable anchor', async () => {
    // Sign with a deadline far in the past relative to a "now" we pin in the future.
    const s = await buildSigned({ ttlSeconds: 300 });
    const future = s.deadline + 10_000n; // now is well past the deadline
    const v = await verifyAttestation({
      payloadBytes: s.bytes,
      attestation: s.signature,
      expectedPublisher: s.publisher,
      payloadHash: s.payloadHash,
      payloadLength: BigInt(s.bytes.length),
      deadline: s.deadline,
      net: NET,
      nowSeconds: future,
    });
    expect(v.expired).toBe(true);
    expect(v.verified).toBe(true); // provenance is immutable; staleness is advisory
    expect(v.hashMatch).toBe(true);
    expect(v.signerMatch).toBe(true);
  });
});

describe('verifyFromEvent (on-chain anchor)', () => {
  it('verifies a BroadcastStreamed-shaped event', async () => {
    const s = await buildSigned();
    const v = await verifyFromEvent(
      {
        publisher: s.publisher,
        payloadHash: s.payloadHash,
        payloadLength: s.bytes.length,
        attestationDeadline: s.deadline,
        attestation: s.signature,
      },
      s.bytes,
      NET,
    );
    expect(v.verified).toBe(true);
    expect(v.recovered?.toLowerCase()).toBe(ACCOUNT_A.address.toLowerCase());
  });

  it('event with no attestation → fail-closed', async () => {
    const s = await buildSigned();
    const v = await verifyFromEvent(
      {
        publisher: s.publisher,
        payloadHash: s.payloadHash,
        payloadLength: s.bytes.length,
        attestationDeadline: s.deadline,
        attestation: null,
      },
      s.bytes,
      NET,
    );
    expect(v.signerMatch).toBeNull();
    expect(v.verified).toBe(false);
  });
});

describe('verifyFromGatewayResponse (X-BYTE-Attestation header)', () => {
  it('verifies a gateway-signed body via the header JSON', async () => {
    // The gateway signs the EXACT body bytes (here a JSON string).
    const body = JSON.stringify({ answer: 42, asOf: '2026-06-14' });
    const bytes = new TextEncoder().encode(body);
    const payloadHash = keccak256(toHex(bytes));
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const signature = await signAttestation(
      {
        publisher: ACCOUNT_A.address as Hex,
        payloadHash,
        payloadLength: BigInt(bytes.length),
        deadline: BigInt(deadline),
      },
      { account: ACCOUNT_A, signTypedData: (a: any) => ACCOUNT_A.signTypedData(a) },
      NET,
    );
    const header = JSON.stringify({
      alg: 'EIP712-PayloadAttestation',
      domain: attestationDomain(NET),
      publisher: ACCOUNT_A.address,
      payloadHash,
      payloadLength: bytes.length,
      deadline,
      signature,
    });
    const v = await verifyFromGatewayResponse(body, header, NET, ACCOUNT_A.address as Hex);
    expect(v.verified).toBe(true);
    expect(v.recovered?.toLowerCase()).toBe(ACCOUNT_A.address.toLowerCase());
  });

  it('missing header → fail-closed', async () => {
    const body = JSON.stringify({ answer: 42 });
    const v = await verifyFromGatewayResponse(body, null, NET, ACCOUNT_A.address as Hex);
    expect(v.signerMatch).toBeNull();
    expect(v.verified).toBe(false);
  });

  it('forged header (different attester than expected) → signerMatch=false', async () => {
    // Body signed by B, but the caller expects A as the known gateway attester.
    const body = JSON.stringify({ answer: 7 });
    const bytes = new TextEncoder().encode(body);
    const payloadHash = keccak256(toHex(bytes));
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const signature = await signAttestation(
      {
        publisher: ACCOUNT_B.address as Hex,
        payloadHash,
        payloadLength: BigInt(bytes.length),
        deadline: BigInt(deadline),
      },
      { account: ACCOUNT_B, signTypedData: (a: any) => ACCOUNT_B.signTypedData(a) },
      NET,
    );
    const header = JSON.stringify({
      publisher: ACCOUNT_B.address, // header claims B
      payloadHash,
      payloadLength: bytes.length,
      deadline,
      signature,
    });
    // Caller pins the real attester = A. B's signature must NOT pass.
    const v = await verifyFromGatewayResponse(body, header, NET, ACCOUNT_A.address as Hex);
    expect(v.hashMatch).toBe(true);
    expect(v.signerMatch).toBe(false);
    expect(v.verified).toBe(false);
  });
});

describe('signAttestation guards', () => {
  it('refuses to sign against a zero/unset dataStream address', async () => {
    const badNet = { ...NET, contracts: { ...NET.contracts, dataStream: ('0x' + '0'.repeat(40)) as Hex } };
    await expect(
      signAttestation(
        {
          publisher: ACCOUNT_A.address as Hex,
          payloadHash: keccak256(toHex(new Uint8Array([1, 2, 3]))),
          payloadLength: 3n,
          deadline: 1n,
        },
        { account: ACCOUNT_A, signTypedData: (a: any) => ACCOUNT_A.signTypedData(a) },
        badNet as any,
      ),
    ).rejects.toThrow(/zero-address|placeholder/);
  });
});
