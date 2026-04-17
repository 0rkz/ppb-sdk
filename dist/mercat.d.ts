import type { SearchParams, PublisherListing, PQSScore, PublisherInfo } from './types';
/**
 * Mercat — Publisher marketplace search and discovery.
 * Reads from the PPB Indexer REST API.
 */
export declare class Mercat {
    private indexerUrl;
    constructor(indexerUrl: string);
    /**
     * Search for publishers by topic, PQS, price, etc.
     */
    search(params?: SearchParams): Promise<PublisherListing[]>;
    /**
     * Get full publisher profile from indexer.
     */
    getPublisher(address: string): Promise<{
        info: PublisherInfo;
        pqs: PQSScore;
        schema: any;
    }>;
    /**
     * Get PQS score breakdown for a publisher.
     */
    getPQS(address: string): Promise<PQSScore>;
    /**
     * Get top publishers by topic.
     */
    getTop(topic: string, limit?: number): Promise<PublisherListing[]>;
    /**
     * Check indexer health and sync status.
     */
    health(): Promise<{
        synced: boolean;
        latestBlock: number;
        indexerCount: number;
    }>;
}
//# sourceMappingURL=mercat.d.ts.map