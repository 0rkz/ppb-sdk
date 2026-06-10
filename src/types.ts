// ─── Publisher Types ─────────────────────────────────────

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
  subscriberCount: number;
  messageCount: number;
  totalRevenue: bigint;
  lastActive: number;
  registeredAt: number;
}

// ─── Subscriber Types ────────────────────────────────────

/**
 * r2 direct-allowance subscription status. There is no escrow contract and no
 * budget/duration: a subscription is the AND of two independent on-chain facts —
 *   - `subscribed`: the social registry flag DataRegistryLib.isSubscribed(
 *     subscriber, publisher) (set by dataRegistry.subscribe(publisher));
 *   - `allowance`: the USDC allowance the subscriber granted to DataStreamLib
 *     (usdc.allowance(subscriber, dataStream)), the cap the publisher's
 *     streamData/streamBroadcast transferFrom-pulls the per-message fee from.
 *
 * `active` is true only when the subscriber is registered AND has a non-zero
 * allowance to the stream contract — otherwise settlement would revert / skip.
 */
export interface Subscription {
  active: boolean;
  subscribed: boolean;
  /** Remaining USDC allowance granted to DataStreamLib (6-decimal atomic). */
  allowance: bigint;
}

export interface StreamMessage {
  publisher: `0x${string}`;
  subscriber: `0x${string}`;
  payloadHash: `0x${string}`;
  payloadLength: number;
  fee: bigint;
  timestamp: number;
  // r2: present on BYTE Library r2 events, undefined on legacy pre-r2.
  // Pass the StreamMessage to verifyEventPayload(msg, bytes) — it no-ops
  // automatically when these are absent.
  attestationDeadline?: bigint;
  attestation?: `0x${string}`;
}

// ─── Mercat Types ────────────────────────────────────────

export interface SearchParams {
  topic?: string;
  maxPricePerKB?: bigint;
  publisherClass?: 'MACHINE' | 'HUMAN';
  sortBy?: 'price' | 'subscribers' | 'revenue';
  limit?: number;
  offset?: number;
}

export interface PublisherListing {
  address: `0x${string}`;
  topic: string;
  tier: string;
  pricePerKB: bigint;
  subscribers: number;
  messageCount: number;
}

// ─── Transaction Types ───────────────────────────────────

export interface TxResult {
  hash: `0x${string}`;
  status: 'success' | 'reverted';
  blockNumber: bigint;
  gasUsed: bigint;
}
