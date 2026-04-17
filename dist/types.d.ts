export interface Schema {
    expectedSize: number;
    maxSize: number;
    frequencySeconds: number;
    publisherClass: 'MACHINE' | 'HUMAN';
    verificationType: 'RTD' | 'TIME_DELAYED' | 'UNVERIFIABLE';
    methodologyHash: `0x${string}`;
    topic: string;
    pricePerKB: bigint;
}
export interface PublisherInfo {
    address: `0x${string}`;
    status: 'NONE' | 'SANDBOX' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';
    tier: 'NEW' | 'ESTABLISHED' | 'TRUSTED' | 'PREMIUM' | 'ELITE';
    takeRate: number;
    stake: bigint;
    subscriberCount: number;
    messageCount: number;
    totalRevenue: bigint;
    lastActive: number;
    registeredAt: number;
}
export interface PublisherStats {
    info: PublisherInfo;
    schema: Schema;
    pqs: PQSScore;
}
export interface Subscription {
    active: boolean;
    budget: bigint;
    spent: bigint;
    maxFeePerMessage: bigint;
    startTime: number;
    duration: number;
    remaining: bigint;
}
export interface StreamMessage {
    publisher: `0x${string}`;
    subscriber: `0x${string}`;
    payloadHash: `0x${string}`;
    payloadLength: number;
    fee: bigint;
    timestamp: number;
}
export type FlagType = 'FACTUAL' | 'BLOAT' | 'QUALITY' | 'FABRICATION';
export interface PQSScore {
    disputeScore: number;
    retentionScore: number;
    freshnessScore: number;
    revenueQuality: number;
    composite: number;
    timestamp: number;
}
export interface SearchParams {
    topic?: string;
    minPQS?: number;
    maxPricePerKB?: bigint;
    publisherClass?: 'MACHINE' | 'HUMAN';
    sortBy?: 'pqs' | 'price' | 'subscribers' | 'revenue';
    limit?: number;
    offset?: number;
}
export interface PublisherListing {
    address: `0x${string}`;
    topic: string;
    tier: string;
    pqs: number;
    pricePerKB: bigint;
    subscribers: number;
    messageCount: number;
}
export interface TxResult {
    hash: `0x${string}`;
    status: 'success' | 'reverted';
    blockNumber: bigint;
    gasUsed: bigint;
}
//# sourceMappingURL=types.d.ts.map