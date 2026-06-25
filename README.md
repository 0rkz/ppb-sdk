# @payperbyte/sdk — PayPerByte TypeScript SDK

TypeScript SDK for PayPerByte (the BYTE Library) — the cryptographically attested, provenance-verifiable data layer for AI agents. Discover first-party feeds, subscribe, stream payloads, and verify every payload against its on-chain EIP-712 attestation (provenance + tamper-evidence — who signed these exact bytes — not a correctness guarantee). No token; USDC settlement on Arbitrum.

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
  verifyPayload,
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

// Verify received bytes against the publisher's on-chain attested hash.
// Signature: verifyPayload(payloadBytes, expectedHash).
// Throws HashMismatchError if the bytes don't match what was attested.
verifyPayload(receivedBytes, message.payloadHash);
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
import { arbitrumSepolia } from "viem/chains";
import { GatewayClient } from "@payperbyte/sdk";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http() });

// Defaults to https://x402.payperbyte.io; pass baseUrl for local dev (:3402).
const gw = new GatewayClient({ signer: account, publicClient });

// Discover the catalog (free) — each feed carries its priceAtomic.
const { feeds } = await gw.discover();

// Pay-per-call a GET feed: unpaid → 402 → wallet signs USDC → retry → data.
const { data, settlement, disclaimerCategory } = await gw.fetchFeed("crypto-top100");
console.log(settlement?.transaction); // on-chain settlement tx hash

// POST oracle (fact-oracle): subscriber_address must ALREADY be a registered,
// allowance-granting on-chain subscriber (a prior Subscriber.subscribe) — the
// answer is broadcast on-chain and its fee is pulled from that allowance.
await gw.fetchFeed("fact-oracle", {
  body: { question: "…", subscriber_address: account.address },
});
```

> Two distinct USDC flows: the on-chain direct-allowance `approve(dataStream)` at
> subscribe time (`Subscriber`) is independent of the x402 EIP-3009 sign at fetch
> time (`GatewayClient`). `fact-oracle` needs the subscriber registered with a
> live DataStream allowance first.

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
  verifyAttestation,
  verifyFromEvent,
  verifyFromGatewayResponse,
  getPQS,
  ARBITRUM_SEPOLIA,
} from "@payperbyte/sdk";

// 1) verify — hash AND signer recovery, before acting on any bytes.
const verdict = await verifyAttestation({
  payloadBytes: receivedBytes,        // the bytes you're about to act on
  attestation: event.attestation,     // 65-byte sig (on-chain event OR gateway header)
  expectedPublisher: publisherAddr,   // who the catalog/registry says the publisher is
  payloadHash: event.payloadHash,
  payloadLength: event.payloadLength,
  deadline: event.attestationDeadline,
  net: ARBITRUM_SEPOLIA,
});
// Verdict: { verified, hashMatch, signerMatch, recovered, expired, reason }
if (!verdict.verified) refuse(verdict.reason);

// Wrappers for the two on-the-wire anchors (same EIP-712 domain):
await verifyFromEvent(event, receivedBytes, ARBITRUM_SEPOLIA);                  // on-chain
await verifyFromGatewayResponse(body, xByteAttestationHeader, ARBITRUM_SEPOLIA, // gateway
  knownGatewayAttester);

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

| Network | Chain ID | Status |
|---------|----------|--------|
| Arbitrum Sepolia | 421614 | Live (testnet) |
| Arbitrum One | 42161 | Planned (mainnet, audit-gated) |

## PayPerByte (BYTE Library)

PayPerByte runs on the BYTE Library — a lean 3-contract core. No token; all settlement is in USDC via a direct-allowance model (the subscriber approves DataStream; the publisher transferFrom-pulls each per-message fee — there is no escrow contract). Each payload carries an EIP-712 `PayloadAttestation` so subscribers can confirm exactly what they received and from whom.

| Contract | Role |
|----------|------|
| DataRegistryLib | Publisher registration, feed/subscriber discovery |
| DataStreamLib | Per-call / per-byte payload delivery + settlement |
| SchemaRegistry | Feed schema + methodology references |

Contract addresses are resolved per-network by the SDK (`ARBITRUM_SEPOLIA`, `LOCAL_ANVIL`).

## Modules

- `ByteClient` — low-level client holding the viem clients and contract instances (used by `Publisher`/`Subscriber`)
- `Publisher` — register a feed, publish data, sign EIP-712 PayloadAttestations
- `Subscriber` — subscribe, receive payloads, stream events
- `verifyPayload` / `verifyEventPayload` / `fetchAndVerify` — subscriber-side **hash-only** payload verification against on-chain attestations
- **Foreseal Kit** — `signAttestation`, `verifyAttestation` / `verify` (hash **and** signer recovery), `verifyFromEvent`, `verifyFromGatewayResponse`, `getPQS`
- `Mercat` — feed search and discovery (connects to the indexer API)
- `GatewayClient` — keyless x402 pay-per-call client (a wallet signs, not an API key); `discover`, `discoverResources`, `fetchFeed`

## Related

- [byte-mcp-server](https://github.com/0rkz/byte-mcp-server) — MCP server for AI agent integration
- [byte-x402-gateway](https://github.com/0rkz/byte-x402-gateway) — keyless x402 payment gateway (a wallet, not an API key)
- [byte-discovery-api](https://github.com/0rkz/byte-discovery-api) — agent discovery endpoint

## License

MIT
