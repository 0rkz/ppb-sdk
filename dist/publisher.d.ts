import { type PPBConfig } from './client';
import type { Schema, PublisherInfo, PublisherStats, TxResult, PQSScore } from './types';
export declare class Publisher {
    private client;
    constructor(config: PPBConfig);
    /**
     * Register a schema and publisher in one flow.
     * 1. Registers schema in SchemaRegistry
     * 2. Approves PPB spending
     * 3. Registers publisher in DataRegistry with stake
     */
    register(schema: Omit<Schema, 'methodologyHash'> & {
        methodology?: string;
    }, stake: bigint): Promise<TxResult>;
    /**
     * Publish data to a specific subscriber.
     * Subscriber must have approved USDC to DataStream.
     */
    publish(subscriber: `0x${string}`, data: any, maxFee?: bigint): Promise<TxResult>;
    /**
     * Broadcast data to multiple subscribers.
     */
    broadcast(subscribers: `0x${string}`[], data: any, maxFeePerSub?: bigint): Promise<TxResult>;
    /**
     * Get publisher info from DataRegistry.
     */
    getInfo(address?: `0x${string}`): Promise<PublisherInfo>;
    /**
     * Get full publisher stats including PQS.
     */
    getStats(address?: `0x${string}`): Promise<PublisherStats>;
    getSchema(address?: `0x${string}`): Promise<Schema>;
    getPQS(address?: `0x${string}`): Promise<PQSScore>;
    /**
     * Estimate fee for a given payload size.
     */
    estimateFee(payloadLength: number): Promise<{
        subscriberFee: bigint;
        publishingFee: bigint;
    }>;
    /**
     * Graduate from sandbox.
     */
    graduate(): Promise<TxResult>;
}
//# sourceMappingURL=publisher.d.ts.map