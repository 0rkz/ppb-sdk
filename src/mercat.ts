import type { SearchParams, PublisherListing, PublisherInfo } from './types';

/**
 * Mercat — Publisher marketplace search and discovery.
 * Reads from the BYTE Library indexer REST API.
 */
export class Mercat {
  private indexerUrl: string;

  constructor(indexerUrl: string) {
    this.indexerUrl = indexerUrl.replace(/\/$/, '');
  }

  /**
   * Search for publishers by topic, price, class, etc.
   */
  async search(params: SearchParams = {}): Promise<PublisherListing[]> {
    const query = new URLSearchParams();
    if (params.topic) query.set('topic', params.topic);
    if (params.maxPricePerKB) query.set('maxPrice', params.maxPricePerKB.toString());
    if (params.publisherClass) query.set('class', params.publisherClass);
    if (params.sortBy) query.set('sort', params.sortBy);
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.offset) query.set('offset', params.offset.toString());

    const res = await fetch(`${this.indexerUrl}/publishers?${query}`);
    if (!res.ok) throw new Error(`Indexer error: ${res.status}`);
    return (await res.json()) as PublisherListing[];
  }

  /**
   * Get full publisher profile from indexer.
   */
  async getPublisher(address: string): Promise<{
    info: PublisherInfo;
    schema: any;
  }> {
    const res = await fetch(`${this.indexerUrl}/publisher/${address}`);
    if (!res.ok) throw new Error(`Indexer error: ${res.status}`);
    return (await res.json()) as { info: PublisherInfo; schema: any };
  }

  /**
   * Get top publishers by topic.
   */
  async getTop(topic: string, limit: number = 10): Promise<PublisherListing[]> {
    return this.search({ topic, sortBy: 'subscribers', limit });
  }

  /**
   * Check indexer health and sync status.
   */
  async health(): Promise<{ synced: boolean; latestBlock: number; indexerCount: number }> {
    const res = await fetch(`${this.indexerUrl}/health`);
    if (!res.ok) throw new Error(`Indexer error: ${res.status}`);
    return (await res.json()) as { synced: boolean; latestBlock: number; indexerCount: number };
  }
}
