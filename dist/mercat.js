/**
 * Mercat — Publisher marketplace search and discovery.
 * Reads from the PPB Indexer REST API.
 */
export class Mercat {
    indexerUrl;
    constructor(indexerUrl) {
        this.indexerUrl = indexerUrl.replace(/\/$/, '');
    }
    /**
     * Search for publishers by topic, PQS, price, etc.
     */
    async search(params = {}) {
        const query = new URLSearchParams();
        if (params.topic)
            query.set('topic', params.topic);
        if (params.minPQS)
            query.set('minPQS', params.minPQS.toString());
        if (params.maxPricePerKB)
            query.set('maxPrice', params.maxPricePerKB.toString());
        if (params.publisherClass)
            query.set('class', params.publisherClass);
        if (params.sortBy)
            query.set('sort', params.sortBy);
        if (params.limit)
            query.set('limit', params.limit.toString());
        if (params.offset)
            query.set('offset', params.offset.toString());
        const res = await fetch(`${this.indexerUrl}/publishers?${query}`);
        if (!res.ok)
            throw new Error(`Indexer error: ${res.status}`);
        return await res.json();
    }
    /**
     * Get full publisher profile from indexer.
     */
    async getPublisher(address) {
        const res = await fetch(`${this.indexerUrl}/publisher/${address}`);
        if (!res.ok)
            throw new Error(`Indexer error: ${res.status}`);
        return await res.json();
    }
    /**
     * Get PQS score breakdown for a publisher.
     */
    async getPQS(address) {
        const res = await fetch(`${this.indexerUrl}/publisher/${address}/pqs`);
        if (!res.ok)
            throw new Error(`Indexer error: ${res.status}`);
        return await res.json();
    }
    /**
     * Get top publishers by topic.
     */
    async getTop(topic, limit = 10) {
        return this.search({ topic, sortBy: 'pqs', limit });
    }
    /**
     * Check indexer health and sync status.
     */
    async health() {
        const res = await fetch(`${this.indexerUrl}/health`);
        if (!res.ok)
            throw new Error(`Indexer error: ${res.status}`);
        return await res.json();
    }
}
//# sourceMappingURL=mercat.js.map