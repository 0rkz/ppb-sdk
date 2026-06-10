import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
  type Transport,
  getContract,
} from 'viem';
import { arbitrumSepolia, arbitrum, foundry } from 'viem/chains';

// ABI imports — using require for JSON compatibility
/* eslint-disable @typescript-eslint/no-var-requires */
const DataRegistryABI = require('../abis/DataRegistry.json');
const SchemaRegistryABI = require('../abis/SchemaRegistry.json');
const DataStreamABI = require('../abis/DataStream.json');

export interface NetworkConfig {
  chainId: number;
  rpcUrl: string;
  contracts: {
    dataRegistry: `0x${string}`;
    schemaRegistry: `0x${string}`;
    dataStream: `0x${string}`;
    /**
     * Settlement USDC (ERC-20) for the on-chain BYTE Library leg. In the r2
     * direct-allowance model the subscriber approves this token to DataStream
     * (allowance cap); the publisher's streamData / streamBroadcast then
     * transferFrom-pulls the exact per-message fee directly from the subscriber.
     * There is NO escrow contract. This is SEPARATE from the x402 gateway USDC
     * (which comes from the 402 accepts[] at runtime — see GatewayClient).
     */
    usdc: `0x${string}`;
  };
  indexerUrl: string;
}

// Minimal ERC-20 ABI — just the surface the SDK needs to approve USDC and read
// allowance for the direct-allowance settlement path.
const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

export interface ByteConfig {
  network: NetworkConfig;
  account?: Account;
  privateKey?: `0x${string}`;
}

function getChain(chainId: number): Chain {
  if (chainId === 42161) return arbitrum;
  if (chainId === 421614) return arbitrumSepolia;
  return foundry;
}

export class ByteClient {
  readonly network: NetworkConfig;
  // Use the concrete inferred client types from viem's factories. The bare
  // `PublicClient`/`WalletClient` aliases collapse getContract's client
  // intersection to `never` under viem 2.x, so we infer from the factory.
  readonly publicClient: ReturnType<typeof createPublicClient>;
  readonly walletClient: ReturnType<typeof createWalletClient> | null;
  readonly chain: Chain;

  // Contract instances
  readonly dataRegistry;
  readonly schemaRegistry;
  readonly dataStream;
  /** Settlement USDC ERC-20 handle (approve / allowance / decimals). */
  readonly usdc;

  constructor(config: ByteConfig) {
    this.network = config.network;
    this.chain = getChain(config.network.chainId);

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.network.rpcUrl),
    });

    if (config.account) {
      this.walletClient = createWalletClient({
        account: config.account,
        chain: this.chain,
        transport: http(config.network.rpcUrl),
      });
    } else {
      this.walletClient = null;
    }

    const c = config.network.contracts;

    // Public client for reads, wallet client for writes. Typed as `any` to
    // sidestep viem 2.x's getContract overload collapsing the dual-client
    // intersection to `never`; runtime behavior is unchanged.
    const client: any = { public: this.publicClient, wallet: this.walletClient! };

    this.dataRegistry = getContract({
      address: c.dataRegistry, abi: DataRegistryABI as any, client,
    });
    this.schemaRegistry = getContract({
      address: c.schemaRegistry, abi: SchemaRegistryABI as any, client,
    });
    this.dataStream = getContract({
      address: c.dataStream, abi: DataStreamABI as any, client,
    });
    this.usdc = getContract({
      address: c.usdc, abi: ERC20_ABI as any, client,
    });
  }

  get account(): `0x${string}` | undefined {
    return this.walletClient?.account?.address;
  }
}
