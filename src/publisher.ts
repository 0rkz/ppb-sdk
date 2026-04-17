import { keccak256, toBytes, encodePacked, parseEther } from 'viem';
import { PPBClient, type PPBConfig } from './client';
import type { Schema, PublisherInfo, PublisherStats, TxResult, PQSScore } from './types';

const STATUS_MAP = ['NONE', 'SANDBOX', 'ACTIVE', 'SUSPENDED', 'BANNED'] as const;
const TIER_MAP = ['NEW', 'ESTABLISHED', 'TRUSTED', 'PREMIUM', 'ELITE'] as const;
const CLASS_MAP = { MACHINE: 0, HUMAN: 1 } as const;
const VTYPE_MAP = { RTD: 0, TIME_DELAYED: 1, UNVERIFIABLE: 2 } as const;

export class Publisher {
  private client: PPBClient;

  constructor(config: PPBConfig) {
    this.client = new PPBClient(config);
  }

  /**
   * Register a schema and publisher in one flow.
   * 1. Registers schema in SchemaRegistry
   * 2. Approves PPB spending
   * 3. Registers publisher in DataRegistry with stake
   */
  async register(schema: Omit<Schema, 'methodologyHash'> & { methodology?: string }, stake: bigint): Promise<TxResult> {
    const methodologyHash = schema.methodology
      ? keccak256(toBytes(schema.methodology))
      : keccak256(toBytes(`ppb-publisher-${Date.now()}`));
    const topicHash = keccak256(toBytes(schema.topic));

    // 1. Register schema
    const schemaTx = await this.client.schemaRegistry.write.registerSchema([
      schema.expectedSize,
      schema.maxSize,
      schema.frequencySeconds,
      CLASS_MAP[schema.publisherClass],
      VTYPE_MAP[schema.verificationType],
      methodologyHash,
      topicHash,
      schema.pricePerKB,
    ]);

    // 2. Approve PPB for staking
    await this.client.ppbToken.write.approve([
      this.client.network.contracts.dataRegistry,
      stake,
    ]);

    // 3. Register publisher
    const pubKeyHash = keccak256(encodePacked(
      ['address', 'uint256'],
      [this.client.account!, BigInt(Date.now())]
    ));

    const tx = await this.client.dataRegistry.write.registerPublisher([stake, pubKeyHash]);

    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash: tx });
    return {
      hash: tx,
      status: receipt.status === 'success' ? 'success' : 'reverted',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  }

  /**
   * Publish data to a specific subscriber.
   * Subscriber must have approved USDC to DataStream.
   */
  async publish(
    subscriber: `0x${string}`,
    data: any,
    maxFee: bigint = 0n
  ): Promise<TxResult> {
    const payload = JSON.stringify(data);
    const payloadBytes = new TextEncoder().encode(payload);
    const payloadHash = keccak256(toBytes(payload));

    // Approve USDC for publishing fee
    // (In production, do this once with max approval)

    const tx = await this.client.dataStream.write.streamData([
      subscriber,
      payloadHash,
      payloadBytes.length,
      maxFee,
    ]);

    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash: tx });
    return {
      hash: tx,
      status: receipt.status === 'success' ? 'success' : 'reverted',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  }

  /**
   * Broadcast data to multiple subscribers.
   */
  async broadcast(
    subscribers: `0x${string}`[],
    data: any,
    maxFeePerSub: bigint = 0n
  ): Promise<TxResult> {
    const payload = JSON.stringify(data);
    const payloadBytes = new TextEncoder().encode(payload);
    const payloadHash = keccak256(toBytes(payload));

    const tx = await this.client.dataStream.write.streamBroadcast([
      subscribers,
      payloadHash,
      payloadBytes.length,
      maxFeePerSub,
    ]);

    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash: tx });
    return {
      hash: tx,
      status: receipt.status === 'success' ? 'success' : 'reverted',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  }

  /**
   * Get publisher info from DataRegistry.
   */
  async getInfo(address?: `0x${string}`): Promise<PublisherInfo> {
    const addr = address || this.client.account!;
    const raw: any = await this.client.dataRegistry.read.getPublisher([addr]);

    return {
      address: addr,
      status: STATUS_MAP[Number(raw.status)] || 'NONE',
      tier: TIER_MAP[Number(raw.tier)] || 'NEW',
      takeRate: Number(await this.client.dataRegistry.read.getPublisherTakeRate([addr])) / 100,
      stake: raw.stake,
      subscriberCount: Number(raw.subscriberCount),
      messageCount: Number(raw.messageCount),
      totalRevenue: raw.totalRevenue,
      lastActive: Number(raw.lastActiveTimestamp),
      registeredAt: Number(raw.registeredAt),
    };
  }

  /**
   * Get full publisher stats including PQS.
   */
  async getStats(address?: `0x${string}`): Promise<PublisherStats> {
    const addr = address || this.client.account!;
    const [info, schema, pqs] = await Promise.all([
      this.getInfo(addr),
      this.getSchema(addr),
      this.getPQS(addr),
    ]);
    return { info, schema, pqs };
  }

  async getSchema(address?: `0x${string}`): Promise<Schema> {
    const addr = address || this.client.account!;
    const raw: any = await this.client.schemaRegistry.read.getSchema([addr]);
    return {
      expectedSize: Number(raw.expectedSize),
      maxSize: Number(raw.maxSize),
      frequencySeconds: Number(raw.frequencySeconds),
      publisherClass: raw.pubClass === 0 ? 'MACHINE' : 'HUMAN',
      verificationType: ['RTD', 'TIME_DELAYED', 'UNVERIFIABLE'][Number(raw.verType)] as any,
      methodologyHash: raw.methodologyHash,
      topic: raw.topic,
      pricePerKB: raw.pricePerKB,
    };
  }

  async getPQS(address?: `0x${string}`): Promise<PQSScore> {
    const addr = address || this.client.account!;
    const raw: any = await this.client.pqsVerifier.read.getVerifiedPQS([addr]);
    return {
      disputeScore: Number(raw.disputeScore),
      retentionScore: Number(raw.retentionScore),
      freshnessScore: Number(raw.freshnessScore),
      revenueQuality: Number(raw.revenueQuality),
      composite: Number(raw.composite),
      timestamp: Number(raw.timestamp),
    };
  }

  /**
   * Estimate fee for a given payload size.
   */
  async estimateFee(payloadLength: number): Promise<{ subscriberFee: bigint; publishingFee: bigint }> {
    const addr = this.client.account!;
    const [subFee, pubFee] = await this.client.dataStream.read.estimateFee([addr, payloadLength]) as [bigint, bigint];
    return { subscriberFee: subFee, publishingFee: pubFee };
  }

  /**
   * Graduate from sandbox.
   */
  async graduate(): Promise<TxResult> {
    const tx = await this.client.dataRegistry.write.graduateFromSandbox();
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash: tx });
    return {
      hash: tx,
      status: receipt.status === 'success' ? 'success' : 'reverted',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  }
}
