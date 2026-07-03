# @payperbyte/sdk — PayPerByte TypeScript SDK

TypeScript SDK for PayPerByte (the BYTE Library) — the cryptographically attested, provenance-verifiable data layer for AI agents. Discover first-party feeds, subscribe, stream payloads, and verify every payload against its on-chain EIP-712 attestation (provenance + tamper-evidence — who signed these exact bytes — not a correctness guarantee). No token; x402 USDC payments settle on **Base mainnet** (the on-chain subscribe + EIP-712 attestation rail is Arbitrum).

## Installation

```bash
npm install @payperbyte/sdk
```

## Quick Start

```typescript
import {
  ByteClient,
  Subscriber,
  Mercat,
  verifyFromEvent,
  ARBITRUM_SEPOLIA,
} from "@payperbyte/sdk";

// `network` is a NetworkConfig object (ARBITRUM_SEPOLIA / LOCAL_ANVIL),
// not a string. RPC URL + contract addresses come from that config.
const client = new ByteClient({ network: ARBITRUM_SEPOLIA });

// Discover publishers and their feeds via the indexer (Mercat).
const mercat = new Mercat(ARBITRUM_SEPOLIA.indexerUrl);
const publishers = await mercat.search({ topic: "eth-price" });

// Subscribe to a data feed — r2 DIRECT-ALLOWANCE model. There is NO escrow.
// subscribe(publisher, allowanceUsdc) does two on-chain things:
//   1. dataRegistry.subscribe(publisher)   — the social-registry flag, and
//   2. usdc.approve(dataStream, cap)        — the spending cap the publisher's
//      streamData/streamBroadcast transferFrom-pulls each per-message fee from.
const subscriber = new Subscriber({
  network: ARBITRUM_SEPOLIA,
  privateKey: "0x...",
});
await subscriber.subscribe(publishers[0].address, 10.0); // $10 allowance cap

// Verify-before-act: recompute the hash AND recover the signer before trusting a
// single byte. verifyFromEvent is the FULL check for an on-chain attestation; the
// x402 gateway path uses verifyFromGatewayResponse (see Foreseal Kit below). The
// hash-only verifyPayload() is the lower-level leg — prefer the full check.
const verdict = await verifyFromEvent(message, receivedBytes, ARBITRUM_SEPOLIA);
if (!verdict.verified) throw new Error(verdict.reason); // do not act on unverified bytes
```

## x402 keyless gateway (pay-per-call)

For one-off, pay-per-call access there is the keyless x402 `GatewayClient`. A
**wallet signs the payment** (gasless EIP-3009 `transferWithAuthorization` — the
facilitator broadcasts and pays gas). There is **no API key**: the wallet is the
credential. The `@x402/core` + `@x402/evm` packages are optional peer deps,
loaded only if you use the gateway.

```typescript
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { GatewayClient } from "@payperbyte/sdk";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
// x402 payments settle on Base mainnet (eip155:8453). publicClient is OPTIONAL for
// the gasless "exact" path — the facilitator broadcasts; pass one only for on-chain reads.
const publicClient = createPublicClient({ chain: base, transport: http() });

// Defaults to https://x402.payperbyte.io; pass baseUrl for local dev (:3402).
const gw = new GatewayClient({ signer: account, publicClient });

// Discover the catalog (free) — each feed carries its priceAtomic.
const { feeds } = await gw.discover();

// Pay-per-call a GET feed: unpaid → 402 → wallet signs USDC → retry → data.
const { data, settlement, disclaimerCategory } = await gw.fetchFeed("defi-yields");
console.log(settlement?.transaction); // on-chain settlement tx hash

// POST oracle (address-reputation): a synchronous signed verdict — pass the query
// body; the paid 200 returns { answer, attestation } you verify before acting.
await gw.fetchFeed("address-reputation", {
  body: { domain: "github.com", address: "0x1111111111111111111111111111111111111111" },
});
```

> Two distinct USDC flows: the on-chain direct-allowance `approve(dataStream)` at
> subscribe time (`Subscriber`) is independent of the x402 EIP-3009 sign at fetch
> time (`GatewayClient`). Pay-per-call via the gateway needs **no** prior
> subscription — the wallet signature is the only credential.

## Foreseal Kit — verify-before-act provenance

The Foreseal Kit is the SDK's headline primitive: **sign**, **verify**, and read a
publisher's **quality score** — so any agent can produce and *fully* verify a
PayPerByte PayloadAttestation without us in the request path.

The legacy `verifyPayload()` checks only the **hash** (`keccak256(bytes) == attestedHash`).
The Foreseal Kit adds the missing **signer** leg: it recovers the EIP-712 attestation
signer and confirms it is the publisher the catalog says it is. A single `Verdict`
composes both legs.

```typescript
import {
  signAttestation,
  verifyFromGatewayResponse,
  verifyFromEvent,
  verifyAttestation,
  getPQS,
  ARBITRUM_SEPOLIA,
} from "@payperbyte/sdk";

// 1) verifyFromGatewayResponse — the headline call for the x402 gateway path (what
// most agents use). It is the FULL decision: recompute keccak256(responseBody) AND recover
// the EIP-712 signer under the net-pinned consensus domain, refuse a forked wire
// domain, and assert the signer is the gateway attester you pinned out-of-band
// (REQUIRED — a self-asserted header can't prove provenance; omitting it fails closed).
const body   = await res.text();                       // the EXACT paid-200 bytes
const header = res.headers.get("X-BYTE-Attestation");  // the raw receipt header
const verdict = await verifyFromGatewayResponse(body, header, ARBITRUM_SEPOLIA, knownGatewayAttester);
// Verdict: { verified, hashMatch, signerMatch, recovered, expired, reason }
if (!verdict.verified) refuse(verdict.reason); // do NOT act on unverified bytes

// On-chain anchor (subscriber/stream path), same EIP-712 domain:
await verifyFromEvent(event, receivedBytes, ARBITRUM_SEPOLIA);

// Lower-level: verifyAttestation takes the fields explicitly (the call the two
// wrappers above compose). verifyPayload() is the hash-only leg — prefer the above.
const v2 = await verifyAttestation({
  payloadBytes: receivedBytes,
  attestation: event.attestation,
  expectedPublisher: publisherAddr,
  payloadHash: event.payloadHash,
  payloadLength: event.payloadLength,
  deadline: event.attestationDeadline,
  net: ARBITRUM_SEPOLIA,
});

// 2) sign — produce an attestation (any viem WalletClient/Account).
const sig = await signAttestation(
  { publisher: account.address, payloadHash, payloadLength, deadline },
  account,
  ARBITRUM_SEPOLIA,
);

// 3) getPQS — read the indexer delivery-quality composite (BPS 0-10000).
const pqs = await getPQS(publisherAddr, ARBITRUM_SEPOLIA.indexerUrl);
// { composite, dispute, retention, freshness, revenueQuality, asOf }
// composite === null → publisher not yet scored.
```

**Verdict rules (these are the contract):**

| Case | `hashMatch` | `signerMatch` | `verified` |
|------|-------------|---------------|------------|
| Known-good | `true` | `true` | `true` |
| Tampered bytes | `false` | — | `false` |
| Wrong/forged signer | `true` | `false` | `false` |
| Empty/missing attestation | (computed) | `null` | `false` — **fail-closed** |

- **Fail-closed on a missing attestation**: a present-but-empty (`"0x"`) or `null`
  attestation yields `signerMatch=null` and `verified=false`. We never "pass on the
  hash alone" — provenance is unproven without the publisher's signature.
- **Expired is advisory, not fatal**: a once-minted `now+300s` deadline elapses on
  every aged feed. `verifyAttestation` sets `expired=true` but does **not** fail
  `verified` on the immutable on-chain anchor — staleness belongs to a freshness
  axis, not the provenance verdict. The caller decides policy.
- **PQS is a reputation signal, not the gate.** The payment-gating verify-before-act
  check is the hash + signer recovery above; `getPQS` is off-chain, advisory, and may
  be absent.
- The `BYTE Library` EIP-712 domain literal is **consensus-critical** and identical
  across the on-chain contract, gateway, MCP, and SDK. It is never renamed.

## Features

- **Feed discovery** — browse and search first-party data feed publishers
- **Subscription management** — subscribe, unsubscribe, check status; r2 direct-allowance USDC settlement (registry flag + `approve(dataStream)`, no escrow)
- **Data streaming** — publish and receive payloads via DataStream
- **Payload verification** — every payload carries an EIP-712 PayloadAttestation; verify `keccak256(bytes)` against the on-chain hash before acting on the data
- **Provenance** — read publisher status, subscriber/message counts, and revenue from the on-chain registry

## Network Support

| Network | Chain ID | Role | Status |
|---------|----------|------|--------|
| Base | 8453 | x402 USDC payment settlement (`GatewayClient`) | **Live (mainnet)** |
| Arbitrum Sepolia | 421614 | On-chain subscribe + EIP-712 attestation anchor | Live (testnet) |
| Arbitrum One | 42161 | Attestation mainnet re-anchor | Planned (audit-gated) |

## PayPerByte (BYTE Library)

PayPerByte runs on the BYTE Library — a lean 3-contract core. No token; all settlement is in USDC via a direct-allowance model (the subscriber approves DataStream; the publisher transferFrom-pulls each per-message fee — there is no escrow contract). Each payload carries an EIP-712 `PayloadAttestation` so subscribers can confirm exactly what they received and from whom.

| Contract | Role |
|----------|------|
| DataRegistryLib | Publisher registration, feed/subscriber discovery |
| DataStreamLib | Per-call / per-byte payload delivery + settlement |
| SchemaRegistry | Feed schema + methodology references |

Contract addresses are resolved per-network by the SDK (`ARBITRUM_SEPOLIA`, `LOCAL_ANVIL`).

## Canonical payload bytes — two forms, and why byte-exact verification wins

The primary verify path is **byte-exact**: hash the exact bytes you received against the
attested hash. That path needs no canonicalization at all and is the strongest tamper
evidence the SDK offers. Prefer it whenever you hold the delivered bytes.

Canonicalization only enters when a payload is *re-serialized* — and the stack has **two
canonical-JSON forms**, not one:

- **SDK publish path** (`canonical.ts`): recursively key-sorted, no whitespace. Matches the
  Python SDK for payloads that keep values to strings/bools/ints; floats, huge ints, and
  non-BMP keys are explicitly out of scope (this is NOT full RFC 8785/JCS).
- **First-party live feeds** (`data-feeds`): INSERTION-ORDER compact JSON — a frozen
  hash-compatibility surface that must never be re-sorted.

A payload signed under one form will not hash-match a re-derivation under the other, so
`fetchAndVerify` is **form-aware**: it tries the raw response bytes and every known form, and
if none reproduces the attested hash it throws **`CanonicalFormMismatchError`** — deliberately
NOT `HashMismatchError`, because a failed re-serialization cannot distinguish tampering from a
form mismatch. Fail closed either way: don't consume the payload; fetch the exact delivered
bytes and use byte-exact `verifyPayload`.

## Modules

- `ByteClient` — low-level client holding the viem clients and contract instances (used by `Publisher`/`Subscriber`)
- `Publisher` — register a feed, publish data, sign EIP-712 PayloadAttestations
- `Subscriber` — subscribe, receive payloads, stream events
- `verifyPayload` / `verifyEventPayload` — byte-exact **hash-only** payload verification against on-chain attestations
- `fetchAndVerify` — archive fetch + **form-aware** verification; throws `CanonicalFormMismatchError` (fail-closed) rather than a false tamper alarm when a re-derivation matches no known canonical form
- **Foreseal Kit** — `signAttestation`, `verifyAttestation` / `verify` (hash **and** signer recovery), `verifyFromEvent`, `verifyFromGatewayResponse`, `getPQS`
- `Mercat` — feed search and discovery (connects to the indexer API)
- `GatewayClient` — keyless x402 pay-per-call client (a wallet signs, not an API key); `discover`, `discoverResources`, `fetchFeed`

## Related

- [byte-mcp-server](https://github.com/0rkz/byte-mcp-server) — MCP server for AI agent integration
- [byte-x402-gateway](https://github.com/0rkz/byte-x402-gateway) — keyless x402 payment gateway (a wallet, not an API key)
- [byte-discovery-api](https://github.com/0rkz/byte-discovery-api) — agent discovery endpoint

**Want the pre-wired, deploy-ready kit?** MCP + Verify-Before-Act Agent Starter Kit — give an agent a wallet that verifies receipts before acting. The SDK here stays free MIT; the kit is the assembly + walkthrough. $39 → https://payperbyte.gumroad.com/l/pvykda

## License

MIT
