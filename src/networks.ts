import type { NetworkConfig } from './client';

export const LOCAL_ANVIL: NetworkConfig = {
  chainId: 31337,
  rpcUrl: 'http://localhost:8545',
  contracts: {
    dataRegistry: '0x0000000000000000000000000000000000000000',
    schemaRegistry: '0x0000000000000000000000000000000000000000',
    dataStream: '0x0000000000000000000000000000000000000000',
    // TODO(deploy): set to the local MockUSDC3009 address printed by the
    // `DeployByteLibrary` forge script when running against a local Anvil node.
    usdc: '0x0000000000000000000000000000000000000000',
  },
  indexerUrl: 'http://localhost:8080',
};

export const ARBITRUM_SEPOLIA: NetworkConfig = {
  chainId: 421614,
  rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
  contracts: {
    // BYTE Library r2 (no-token, direct-allowance settlement). Cited:
    // contracts/deployments/arbitrum-sepolia.json "byte-library" block — the
    // r2 DataStreamLib redeploy (2026-05-24) supersedes the dead v0.5 token-era
    // DataStream/DataRegistry/StreamSubscription stack.
    dataRegistry: '0x086990937Cf931e36E01487CD63407f281f1Fc6A',
    schemaRegistry: '0x4102BA342A3e9f495bD553D99D1590470C32EE88',
    dataStream: '0x44729bB148F46d8Db509E47b0453edc271e06e95',
    // Settlement USDC = the production MockUSDC3009 the byte-library contracts
    // were deployed against. Cited: contracts/deployments/arbitrum-sepolia.json
    // ("byte-library".USDC == "0x1c16659…", the same token DataStreamLib was
    // constructed with) and x402-gateway/src/lib/config.ts (usdcAddress default).
    usdc: '0x1c16659aeb3aE28467E90348fAAB8874a0D3A4d3',
  },
  // Hosted PayPerByte indexer that indexes the Arbitrum-Sepolia BYTE Library
  // deployment. Serves Mercat (`/publishers`, `/publisher/{addr}`, `/health`)
  // AND getPQS (`/publisher/{addr}/pqs`). NOT api.payperbyte.io — that host does
  // not serve the /pqs path (404). For a local indexer, override with the URL
  // explicitly (the LOCAL_ANVIL config above keeps localhost:8080).
  indexerUrl: 'https://feeds.payperbyte.io',
};

export const ARBITRUM_ONE: NetworkConfig = {
  chainId: 42161,
  rpcUrl: 'https://arb1.arbitrum.io/rpc',
  contracts: {
    dataRegistry: '0x0000000000000000000000000000000000000000',
    schemaRegistry: '0x0000000000000000000000000000000000000000',
    dataStream: '0x0000000000000000000000000000000000000000',
    // Circle-published native USDC on Arbitrum One. Cited: Circle's official
    // address (also used in data-feeds/stablecoin-rails/feed.py). TODO(confirm):
    // the BYTE Library core is not yet deployed to Arbitrum One (mainnet is
    // audit-gated). Confirm the settlement token at mainnet deploy time before
    // relying on this — the contracts must be constructed with this exact USDC.
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  indexerUrl: '',
};
