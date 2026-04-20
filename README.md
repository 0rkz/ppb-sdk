# @ppb/sdk — Byte Protocol TypeScript SDK

TypeScript SDK for interacting with the Pay-Per-Byte Protocol (Byte) on Arbitrum.

## Installation

```bash
npm install github:0rkz/ppb-sdk
```

## Quick Start

```typescript
import { PPBClient } from "@ppb/sdk";

const client = new PPBClient({
  rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  network: "arbitrum-sepolia",
});

// Browse publishers
const publishers = await client.getPublishers();

// Subscribe to a data feed
await client.subscribe(publisherAddress, { privateKey: "0x..." });

// Get publisher reputation
const pqs = await client.getPQS(publisherAddress);
```

## Features

- **Publisher discovery** — browse and search data feed publishers
- **Subscription management** — subscribe, unsubscribe, check status
- **Reputation queries** — PQS scores, tier info, dispute history
- **Data streaming** — publish and receive data via DataStream
- **Token operations** — PPB balance, approvals, staking

## Network Support

| Network | Chain ID | Status |
|---------|----------|--------|
| Arbitrum Sepolia | 421614 | Live (testnet) |
| Arbitrum One | 42161 | Planned (mainnet) |

## Contract Addresses (Arbitrum Sepolia)

```
PPBToken:          0x37a86eD3ee87109ff8cF96B3fe45c70a2ebB69f3
DataRegistry:      0x05D89769A066549115b1B4408bFf899D2737F30b
DataStream:        0x7E12bF2B0d43B9Ea0Bc37A06EcAC36b810351F35
SchemaRegistry:    0x2e490F33180F3d387d46c213ADf776135c052acf
ReputationEngine:  0x3b842Aac0b932D546ed6C87895350EaeF0bEbcc3
PQSVerifier:       0x67F97fc5E45889d3BFf7dcBA114Ca210f1896b0d
RelayRegistry:     0xFADfB804F76A4FBcB44ACf72519A403A9ff02618
ValidatorRegistry: 0xEd0Ffa5201994cAC3e17566f445C5D0d0103F016
TestnetFaucet:     0x19d25F286b8Dca21886bCBe9c21334C6F0C532FB
```

## Modules

- `PPBClient` — main client with publisher, subscriber, and marketplace methods
- `Publisher` — register, publish data, manage schema
- `Subscriber` — subscribe, receive data, file disputes
- `Mercat` — marketplace search and discovery (connects to indexer API)

## Related

- [byte-mcp-server](https://github.com/0rkz/byte-mcp-server) — MCP server for AI agent integration
- [byte-x402-gateway](https://github.com/0rkz/byte-x402-gateway) — HTTP payment gateway via x402
- [byte-discovery-api](https://github.com/0rkz/byte-discovery-api) — Agent discovery endpoint

## License

MIT
