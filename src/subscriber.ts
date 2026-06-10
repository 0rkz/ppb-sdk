import { parseUnits } from 'viem';
import { ByteClient, type ByteConfig } from './client';
import type { Subscription, StreamMessage, TxResult } from './types';

export class Subscriber {
  private client: ByteClient;

  constructor(config: ByteConfig) {
    this.client = new ByteClient(config);
  }

  /**
   * Subscribe to a publisher's data stream — r2 DIRECT-ALLOWANCE model.
   *
   * There is NO escrow contract. Two on-chain facts make a subscription work:
   *   (1) dataRegistry.subscribe(publisher) — the social registry flag the
   *       publisher's stream path checks via isSubscribed(); and
   *   (2) usdc.approve(dataStream, allowanceCap) — the spending cap the
   *       publisher's streamData / streamBroadcast transferFrom-pulls each
   *       per-message fee directly from the subscriber against (publisher take
   *       + dev fund). No budget is custodied; the allowance is just a ceiling.
   *
   * @param publisher Publisher address
   * @param allowanceUsdc USDC allowance cap to grant DataStream (e.g., 10.0 for
   *        $10). This bounds total spend until you re-approve; per-message cost
   *        is the schema fee, not a deduction from a custodied budget.
   */
  async subscribe(
    publisher: `0x${string}`,
    allowanceUsdc: number,
  ): Promise<TxResult> {
    // 6-decimal USDC scaling.
    const allowanceCap = parseUnits(allowanceUsdc.toString(), 6);

    const account = this.client.account!;
    const dataStreamAddr = this.client.network.contracts.dataStream;

    // (1) Cross-check the live stream contract's settlement token against our
    // config so address drift can't silently approve the wrong token. The r2
    // DataStreamLib exposes its immutable settlement asset as usdc().
    const onchainUsdc = (await this.client.dataStream.read.usdc()) as `0x${string}`;
    if (onchainUsdc.toLowerCase() !== this.client.network.contracts.usdc.toLowerCase()) {
      throw new Error(
        `USDC address mismatch: DataStream.usdc()=${onchainUsdc} but ` +
          `NetworkConfig.contracts.usdc=${this.client.network.contracts.usdc}. ` +
          'Refusing to approve — fix the network config.',
      );
    }

    // (2) Register in the social registry — bumps the publisher's subscriberCount
    // and sets the isSubscribed flag the stream path gates on. Idempotent: the
    // contract reverts AlreadySubscribed if already registered, which we ignore.
    let registryTx: TxResult | null = null;
    try {
      const regHash = await this.client.dataRegistry.write.subscribe([publisher]);
      const regReceipt = await this.client.publicClient.waitForTransactionReceipt({ hash: regHash });
      registryTx = {
        hash: regHash,
        status: regReceipt.status === 'success' ? 'success' : 'reverted',
        blockNumber: regReceipt.blockNumber,
        gasUsed: regReceipt.gasUsed,
      };
    } catch {
      // Already subscribed in DataRegistry — continue to the allowance step.
    }

    // (3) Direct-allowance approve: grant DataStream the spending cap so the
    // publisher's streamData/streamBroadcast can transferFrom the per-message fee
    // straight from the subscriber. Skip the approve only if the existing
    // allowance already meets the requested cap.
    const allowance = (await this.client.usdc.read.allowance([account, dataStreamAddr])) as bigint;
    if (allowance >= allowanceCap) {
      // Allowance already sufficient. Return the registry tx if we just made one;
      // otherwise the subscription is fully in place and there is nothing to send.
      if (registryTx) return registryTx;
      throw new Error(
        'Already subscribed: DataRegistry flag set and USDC allowance to ' +
          'DataStream already >= the requested cap. Nothing to do. Call ' +
          'getSubscription() to inspect, or pass a higher allowanceUsdc to raise the cap.',
      );
    }

    const approveTx = await this.client.usdc.write.approve([dataStreamAddr, allowanceCap]);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash: approveTx });
    return {
      hash: approveTx,
      status: receipt.status === 'success' ? 'success' : 'reverted',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  }

  /**
   * Unsubscribe from a publisher — r2 model. Clears BOTH on-chain facts:
   * removes the social-registry flag (dataRegistry.unsubscribe) and revokes the
   * USDC allowance to DataStream (approve(dataStream, 0)) so no further
   * per-message fee can be pulled. There is no escrow to refund. Returns the
   * allowance-revoke receipt.
   */
  async unsubscribe(publisher: `0x${string}`): Promise<TxResult> {
    const dataStreamAddr = this.client.network.contracts.dataStream;

    // Clear the social-registry flag. Reverts NotSubscribed if not registered —
    // ignore so allowance revocation still proceeds.
    try {
      const regTx = await this.client.dataRegistry.write.unsubscribe([publisher]);
      await this.client.publicClient.waitForTransactionReceipt({ hash: regTx });
    } catch {
      // Not registered in DataRegistry — proceed to revoke allowance.
    }

    // Revoke the DataStream allowance so no further fees can be transferFrom-ed.
    const tx = await this.client.usdc.write.approve([dataStreamAddr, 0n]);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash: tx });
    return {
      hash: tx,
      status: receipt.status === 'success' ? 'success' : 'reverted',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  }

  /**
   * Get subscription status for a publisher — r2 direct-allowance model.
   * Reads the two independent on-chain facts: the social-registry flag
   * (dataRegistry.isSubscribed) and the USDC allowance granted to DataStream
   * (usdc.allowance). `active` is their AND — registered AND non-zero allowance.
   */
  async getSubscription(publisher: `0x${string}`): Promise<Subscription> {
    const addr = this.client.account!;
    const dataStreamAddr = this.client.network.contracts.dataStream;

    const subscribed = (await this.client.dataRegistry.read.isSubscribed([addr, publisher])) as boolean;
    const allowance = (await this.client.usdc.read.allowance([addr, dataStreamAddr])) as bigint;

    return {
      active: subscribed && allowance > 0n,
      subscribed,
      allowance,
    };
  }

  /**
   * Check if a subscription is live — registered in the social registry AND
   * holding a non-zero USDC allowance to DataStream (otherwise the publisher's
   * settlement would revert / skip this subscriber).
   */
  async isActive(publisher: `0x${string}`): Promise<boolean> {
    const { active } = await this.getSubscription(publisher);
    return active;
  }

  /**
   * Stream incoming messages. Watches DataStreamed events for this subscriber.
   * Returns an async iterator of messages.
   */
  async *stream(publisher?: `0x${string}`): AsyncGenerator<StreamMessage> {
    const addr = this.client.account!;

    // Watch for DataStreamed events targeting this subscriber
    const unwatch = this.client.publicClient.watchContractEvent({
      address: this.client.network.contracts.dataStream,
      abi: [{
        type: 'event',
        name: 'DataStreamed',
        inputs: [
          { name: 'publisher', type: 'address', indexed: true },
          { name: 'subscriber', type: 'address', indexed: true },
          { name: 'payloadHash', type: 'bytes32' },
          { name: 'payloadLength', type: 'uint256' },
          { name: 'subscriberFee', type: 'uint256' },
          { name: 'publisherRevenue', type: 'uint256' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'attestationDeadline', type: 'uint256' },
          { name: 'attestation', type: 'bytes' },
        ],
      }],
      args: {
        subscriber: addr,
        ...(publisher ? { publisher } : {}),
      },
      onLogs: () => {}, // Handled by polling below
    });

    // Poll-based approach for compatibility
    let lastBlock = await this.client.publicClient.getBlockNumber();

    try {
      while (true) {
        await new Promise(r => setTimeout(r, 2000)); // 2s polling interval

        const currentBlock = await this.client.publicClient.getBlockNumber();
        if (currentBlock <= lastBlock) continue;

        const logs = await this.client.publicClient.getContractEvents({
          address: this.client.network.contracts.dataStream,
          abi: [{
            type: 'event',
            name: 'DataStreamed',
            inputs: [
              { name: 'publisher', type: 'address', indexed: true },
              { name: 'subscriber', type: 'address', indexed: true },
              { name: 'payloadHash', type: 'bytes32' },
              { name: 'payloadLength', type: 'uint256' },
              { name: 'subscriberFee', type: 'uint256' },
              { name: 'publisherRevenue', type: 'uint256' },
              { name: 'timestamp', type: 'uint256' },
            ],
          }],
          args: {
            subscriber: addr,
            ...(publisher ? { publisher } : {}),
          },
          fromBlock: lastBlock + 1n,
          toBlock: currentBlock,
        });

        for (const log of logs) {
          const args = log.args as any;
          // r2: events carry attestationDeadline + attestation. Surface as
          // undefined on legacy pre-r2 events so verifyEventPayload can no-op.
          yield {
            publisher: args.publisher,
            subscriber: args.subscriber,
            payloadHash: args.payloadHash,
            payloadLength: Number(args.payloadLength),
            fee: args.subscriberFee,
            timestamp: Number(args.timestamp),
            attestationDeadline: args.attestationDeadline ?? undefined,
            attestation: args.attestation ?? undefined,
          };
        }

        lastBlock = currentBlock;
      }
    } finally {
      unwatch();
    }
  }
}
