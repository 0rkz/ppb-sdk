import { keccak256, toBytes, toHex, encodePacked, type Hex } from 'viem';
import { ByteClient, type ByteConfig } from './client';
import { canonicalBytes } from './canonical';
import { signAttestation } from './attestation';
import type { Schema, PublisherInfo, TxResult } from './types';

const ATTESTATION_TTL_S = 300; // 5-minute attestation freshness window.

const STATUS_MAP = ['NONE', 'SANDBOX', 'ACTIVE', 'SUSPENDED', 'BANNED'] as const;
const CLASS_MAP = { MACHINE: 0, HUMAN: 1 } as const;
const VTYPE_MAP = { RTD: 0, TIME_DELAYED: 1, UNVERIFIABLE: 2 } as const;

export class Publisher {
  private client: ByteClient;

  constructor(config: ByteConfig) {
    this.client = new ByteClient(config);
  }

  /**
   * Register a schema and publisher in one flow. No token, no stake —
   * v1 BYTE Library settles in external USDC, registration is keyless.
   * 1. Registers schema in SchemaRegistry
   * 2. Registers publisher in DataRegistry (no stake)
   */
  async register(schema: Omit<Schema, 'methodologyHash'> & { methodology?: string }): Promise<TxResult> {
    const methodologyHash = schema.methodology
      ? keccak256(toBytes(schema.methodology))
      : keccak256(toBytes(`byte-publisher-${Date.now()}`));
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

    // 2. Register publisher. No token stake in v1: the on-chain
    // registerPublisher(uint256 amount, bytes32 publicKey) signature is
    // called with amount=0 (no economic stake; USDC is the only asset).
    const pubKeyHash = keccak256(encodePacked(
      ['address', 'uint256'],
      [this.client.account!, BigInt(Date.now())]
    ));

    // r2 DataRegistryLib: registerPublisher(uint256 amount, bytes32 publicKey)
    // safeTransferFrom-pulls the settlement token ONLY when amount > 0, and v1
    // sets STAKE_FLOOR = 0 (no publisher bond). With amount=0 no approve is
    // needed at register time. If a future (Phase B / BYTE Library Open) build
    // passes amount>0, add an approve(dataRegistry, amount) on the settlement
    // ERC-20 (this.client.usdc) BEFORE registerPublisher. Verified against
    // contracts/src/library/DataRegistryLib.sol registerPublisher().
    const tx = await this.client.dataRegistry.write.registerPublisher([0n, pubKeyHash]);

    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash: tx });
    return {
      hash: tx,
      status: receipt.status === 'success' ? 'success' : 'reverted',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  }

  /**
   * Sign an EIP-712 PayloadAttestation for the active chain + DataStream
   * contract. r2 (2026-05-23) — returns the 65-byte signature hex which the
   * contract verifies before settling. The struct is emitted in the
   * settlement event so subscribers can re-verify out-of-band.
   *
   * Thin wrapper over the hoisted standalone `signAttestation` (attestation.ts)
   * — the Trust Kit primitive — so the sign path is one shared implementation.
   */
  private async signAttestation(
    payloadHash: Hex,
    payloadLength: number,
    deadline: bigint,
  ): Promise<Hex> {
    const wallet = this.client.walletClient;
    if (!wallet?.account) {
      throw new Error('Publisher.signAttestation: wallet has no account');
    }
    return signAttestation(
      {
        publisher: wallet.account.address,
        payloadHash,
        payloadLength: BigInt(payloadLength),
        deadline,
      },
      // viem WalletClient: signTypedData needs the bound account.
      {
        account: wallet.account,
        signTypedData: (args: any) => wallet.signTypedData(args),
      },
      this.client.network,
    );
  }

  /**
   * Publish data to a specific subscriber (r2: signs PayloadAttestation).
   * No per-publish USDC approve is needed on the publisher side: in the r2
   * direct-allowance model the SUBSCRIBER approved DataStream at subscribe time,
   * and streamData transferFrom-pulls the per-message fee straight from the
   * subscriber (publisher take + dev fund). If the subscriber's allowance is
   * insufficient, the on-chain transferFrom reverts.
   */
  async publish(
    subscriber: `0x${string}`,
    data: any,
    maxFee: bigint = 0n
  ): Promise<TxResult> {
    // Canonical-JSON hash: identical bytes to the verify side and to the Python
    // SDK (recursively key-sorted, no whitespace). See canonical.ts.
    const payloadBytes = canonicalBytes(data);
    const payloadHash = keccak256(toHex(payloadBytes));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + ATTESTATION_TTL_S);
    const signature = await this.signAttestation(payloadHash, payloadBytes.length, deadline);

    const tx = await this.client.dataStream.write.streamData([
      subscriber,
      payloadHash,
      BigInt(payloadBytes.length),
      maxFee,
      { deadline, signature },
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
   * Broadcast data to multiple subscribers (r2: signs PayloadAttestation).
   */
  async broadcast(
    subscribers: `0x${string}`[],
    data: any,
    maxFeePerSub: bigint = 0n
  ): Promise<TxResult> {
    // Canonical-JSON hash — same helper as publish() and the verify side.
    const payloadBytes = canonicalBytes(data);
    const payloadHash = keccak256(toHex(payloadBytes));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + ATTESTATION_TTL_S);
    const signature = await this.signAttestation(payloadHash, payloadBytes.length, deadline);

    const tx = await this.client.dataStream.write.streamBroadcast([
      subscribers,
      payloadHash,
      BigInt(payloadBytes.length),
      maxFeePerSub,
      { deadline, signature },
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
      subscriberCount: Number(raw.subscriberCount),
      messageCount: Number(raw.messageCount),
      totalRevenue: raw.totalRevenue,
      lastActive: Number(raw.lastActiveTimestamp),
      registeredAt: Number(raw.registeredAt),
    };
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

  /**
   * Estimate the subscriber fee for a given payload size. r2 DataStreamLib.
   * estimateFee returns a SINGLE subscriberFee — the v0.5/v0.6 per-message
   * publishing fee is removed in BYTE Library r2 (first-party: it would be
   * BYTEDev paying BYTEDev), so there is no second return value.
   */
  async estimateFee(payloadLength: number): Promise<{ subscriberFee: bigint }> {
    const addr = this.client.account!;
    const subscriberFee = await this.client.dataStream.read.estimateFee([addr, payloadLength]) as bigint;
    return { subscriberFee };
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
