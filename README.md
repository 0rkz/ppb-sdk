# @payperbyte/sdk — PayPerByte TypeScript SDK

TypeScript SDK for PayPerByte (the BYTE Library) — the verified, provenance-first data layer for AI agents. Discover first-party feeds, subscribe, stream payloads, and verify every payload against its on-chain EIP-712 attestation. No token; USDC settlement on Arbitrum.

## Installation

```bash
npm install github:0rkz/byte-sdk
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
- `verifyPayload` / `verifyEventPayload` / `fetchAndVerify` — subscriber-side payload verification against on-chain attestations
- `Mercat` — feed search and discovery (connects to the indexer API)
- `GatewayClient` — keyless x402 pay-per-call client (a wallet signs, not an API key); `discover`, `discoverResources`, `fetchFeed`

## Related

- [byte-mcp-server](https://github.com/0rkz/byte-mcp-server) — MCP server for AI agent integration
- [byte-x402-gateway](https://github.com/0rkz/byte-x402-gateway) — keyless x402 payment gateway (a wallet, not an API key)
- [byte-discovery-api](https://github.com/0rkz/byte-discovery-api) — agent discovery endpoint

## License

MIT
