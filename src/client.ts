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
const StreamSubscriptionABI = require('../abis/StreamSubscription.json');
const ReputationEngineABI = require('../abis/ReputationEngine.json');
const PPBTokenABI = require('../abis/PPBToken.json');
const DividendPoolABI = require('../abis/DividendPool.json');
const PQSVerifierABI = require('../abis/PQSVerifier.json');

export interface NetworkConfig {
  chainId: number;
  rpcUrl: string;
  contracts: {
    ppbToken: `0x${string}`;
    dataRegistry: `0x${string}`;
    schemaRegistry: `0x${string}`;
    dataStream: `0x${string}`;
    streamSubscription: `0x${string}`;
    reputationEngine: `0x${string}`;
    dividendPool: `0x${string}`;
    burnEngine: `0x${string}`;
    relayRegistry: `0x${string}`;
    pqsVerifier: `0x${string}`;
  };
  indexerUrl: string;
}

export interface PPBConfig {
  network: NetworkConfig;
  account?: Account;
  privateKey?: `0x${string}`;
}

function getChain(chainId: number): Chain {
  if (chainId === 42161) return arbitrum;
  if (chainId === 421614) return arbitrumSepolia;
  return foundry;
}

export class PPBClient {
  readonly network: NetworkConfig;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient | null;
  readonly chain: Chain;

  // Contract instances
  readonly ppbToken;
  readonly dataRegistry;
  readonly schemaRegistry;
  readonly dataStream;
  readonly streamSubscription;
  readonly reputationEngine;
  readonly dividendPool;
  readonly pqsVerifier;

  constructor(config: PPBConfig) {
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

    this.ppbToken = getContract({
      address: c.ppbToken, abi: PPBTokenABI as any,
      client: { public: this.publicClient, wallet: this.walletClient! },
    });
    this.dataRegistry = getContract({
      address: c.dataRegistry, abi: DataRegistryABI as any,
      client: { public: this.publicClient, wallet: this.walletClient! },
    });
    this.schemaRegistry = getContract({
      address: c.schemaRegistry, abi: SchemaRegistryABI as any,
      client: { public: this.publicClient, wallet: this.walletClient! },
    });
    this.dataStream = getContract({
      address: c.dataStream, abi: DataStreamABI as any,
      client: { public: this.publicClient, wallet: this.walletClient! },
    });
    this.streamSubscription = getContract({
      address: c.streamSubscription, abi: StreamSubscriptionABI as any,
      client: { public: this.publicClient, wallet: this.walletClient! },
    });
    this.reputationEngine = getContract({
      address: c.reputationEngine, abi: ReputationEngineABI as any,
      client: { public: this.publicClient, wallet: this.walletClient! },
    });
    this.dividendPool = getContract({
      address: c.dividendPool, abi: DividendPoolABI as any,
      client: { public: this.publicClient, wallet: this.walletClient! },
    });
    this.pqsVerifier = getContract({
      address: c.pqsVerifier, abi: PQSVerifierABI as any,
      client: { public: this.publicClient, wallet: this.walletClient! },
    });
  }

  get account(): `0x${string}` | undefined {
    return this.walletClient?.account?.address;
  }
}
