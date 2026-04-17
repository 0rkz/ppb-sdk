import { type PPBConfig } from './client';
import type { Subscription, StreamMessage, FlagType, TxResult } from './types';
export declare class Subscriber {
    private client;
    constructor(config: PPBConfig);
    /**
     * Subscribe to a publisher's data stream.
     * Approves and deposits USDC into StreamSubscription escrow.
     *
     * @param publisher Publisher address
     * @param budgetUsdc Budget in USDC (e.g., 10.0 for $10)
     * @param maxFeePerMessage Max USDC per message (e.g., 0.005 for $0.005)
     * @param durationDays Duration in days (0 = indefinite until budget depleted)
     */
    subscribe(publisher: `0x${string}`, budgetUsdc: number, maxFeePerMessage?: number, durationDays?: number): Promise<TxResult>;
    /**
     * Unsubscribe from a publisher. Returns remaining escrow minus
     * termination fee (5%, waived if expired or publisher abandoned).
     */
    unsubscribe(publisher: `0x${string}`): Promise<TxResult>;
    /**
     * Get subscription details for a publisher.
     */
    getSubscription(publisher: `0x${string}`): Promise<Subscription>;
    /**
     * Check if subscription is active.
     */
    isActive(publisher: `0x${string}`): Promise<boolean>;
    /**
     * Stream incoming messages. Watches DataStreamed events for this subscriber.
     * Returns an async iterator of messages.
     */
    stream(publisher?: `0x${string}`): AsyncGenerator<StreamMessage>;
    /**
     * File a dispute flag against a publisher.
     */
    flag(publisher: `0x${string}`, flagType: FlagType, messageHash: `0x${string}`): Promise<TxResult>;
}
//# sourceMappingURL=subscriber.d.ts.map