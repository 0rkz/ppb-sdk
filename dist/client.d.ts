import { type PublicClient, type WalletClient, type Account, type Chain } from 'viem';
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
export declare class PPBClient {
    readonly network: NetworkConfig;
    readonly publicClient: PublicClient;
    readonly walletClient: WalletClient | null;
    readonly chain: Chain;
    readonly ppbToken: any;
    readonly dataRegistry: any;
    readonly schemaRegistry: any;
    readonly dataStream: any;
    readonly streamSubscription: any;
    readonly reputationEngine: any;
    readonly dividendPool: any;
    readonly pqsVerifier: any;
    constructor(config: PPBConfig);
    get account(): `0x${string}` | undefined;
}
//# sourceMappingURL=client.d.ts.map