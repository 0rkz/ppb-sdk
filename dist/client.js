import { createPublicClient, createWalletClient, http, getContract, } from 'viem';
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
function getChain(chainId) {
    if (chainId === 42161)
        return arbitrum;
    if (chainId === 421614)
        return arbitrumSepolia;
    return foundry;
}
export class PPBClient {
    network;
    publicClient;
    walletClient;
    chain;
    // Contract instances
    ppbToken;
    dataRegistry;
    schemaRegistry;
    dataStream;
    streamSubscription;
    reputationEngine;
    dividendPool;
    pqsVerifier;
    constructor(config) {
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
        }
        else {
            this.walletClient = null;
        }
        const c = config.network.contracts;
        this.ppbToken = getContract({
            address: c.ppbToken, abi: PPBTokenABI,
            client: { public: this.publicClient, wallet: this.walletClient },
        });
        this.dataRegistry = getContract({
            address: c.dataRegistry, abi: DataRegistryABI,
            client: { public: this.publicClient, wallet: this.walletClient },
        });
        this.schemaRegistry = getContract({
            address: c.schemaRegistry, abi: SchemaRegistryABI,
            client: { public: this.publicClient, wallet: this.walletClient },
        });
        this.dataStream = getContract({
            address: c.dataStream, abi: DataStreamABI,
            client: { public: this.publicClient, wallet: this.walletClient },
        });
        this.streamSubscription = getContract({
            address: c.streamSubscription, abi: StreamSubscriptionABI,
            client: { public: this.publicClient, wallet: this.walletClient },
        });
        this.reputationEngine = getContract({
            address: c.reputationEngine, abi: ReputationEngineABI,
            client: { public: this.publicClient, wallet: this.walletClient },
        });
        this.dividendPool = getContract({
            address: c.dividendPool, abi: DividendPoolABI,
            client: { public: this.publicClient, wallet: this.walletClient },
        });
        this.pqsVerifier = getContract({
            address: c.pqsVerifier, abi: PQSVerifierABI,
            client: { public: this.publicClient, wallet: this.walletClient },
        });
    }
    get account() {
        return this.walletClient?.account?.address;
    }
}
//# sourceMappingURL=client.js.map