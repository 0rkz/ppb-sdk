import type { SearchParams, PublisherListing, PQSScore, PublisherInfo } from './types';

/**
 * Mercat — Publisher marketplace search and discovery.
 * Reads from the PPB Indexer REST API.
 */
export class Mercat {
  private indexerUrl: string;

  constructor(indexerUrl: string) {
    this.indexerUrl = indexerUrl.replace(/\/$/, '');
  }

  /**
   * Search for publishers by topic, PQS, price, etc.
   */
  async search(params: SearchParams = {}): Promise<PublisherListing[]> {
    const query = new URLSearchParams();
    if (params.topic) query.set('topic', params.topic);
    if (params.minPQS) query.set('minPQS', params.minPQS.toString());
    if (params.maxPricePerKB) query.set('maxPrice', params.maxPricePerKB.toString());
    if (params.publisherClass) query.set('class', params.publisherClass);
    if (params.sortBy) query.set('sort', params.sortBy);
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.offset) query.set('offset', params.offset.toString());

    const res = await fetch(`${this.indexerUrl}/publishers?${query}`);
    if (!res.ok) throw new Error(`Indexer error: ${res.status}`);
    return await res.json();
  }

  /**
   * Get full publisher profile from indexer.
   */
  async getPublisher(address: string): Promise<{
    info: PublisherInfo;
    pqs: PQSScore;
    schema: any;
  }> {
    const res = await fetch(`${this.indexerUrl}/publisher/${address}`);
    if (!res.ok) throw new Error(`Indexer error: ${res.status}`);
    return await res.json();
  }

  /**
   * Get PQS score breakdown for a publisher.
   */
  async getPQS(address: string): Promise<PQSScore> {
    const res = await fetch(`${this.indexerUrl}/publisher/${address}/pqs`);
    if (!res.ok) throw new Error(`Indexer error: ${res.status}`);
    return await res.json();
  }

  /**
   * Get top publishers by topic.
   */
  async getTop(topic: string, limit: number = 10): Promise<PublisherListing[]> {
    return this.search({ topic, sortBy: 'pqs', limit });
  }

  /**
   * Check indexer health and sync status.
   */
  async health(): Promise<{ synced: boolean; latestBlock: number; indexerCount: number }> {
    const res = await fetch(`${this.indexerUrl}/health`);
    if (!res.ok) throw new Error(`Indexer error: ${res.status}`);
    return await res.json();
  }
}
