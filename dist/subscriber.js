import { parseUnits } from 'viem';
import { PPBClient } from './client';
const FLAG_MAP = {
    FACTUAL: 0, BLOAT: 1, QUALITY: 2, FABRICATION: 3,
};
export class Subscriber {
    client;
    constructor(config) {
        this.client = new PPBClient(config);
    }
    /**
     * Subscribe to a publisher's data stream.
     * Approves and deposits USDC into StreamSubscription escrow.
     *
     * @param publisher Publisher address
     * @param budgetUsdc Budget in USDC (e.g., 10.0 for $10)
     * @param maxFeePerMessage Max USDC per message (e.g., 0.005 for $0.005)
     * @param durationDays Duration in days (0 = indefinite until budget depleted)
     */
    async subscribe(publisher, budgetUsdc, maxFeePerMessage = 0, durationDays = 30) {
        const budget = parseUnits(budgetUsdc.toString(), 6);
        const maxFee = parseUnits(maxFeePerMessage.toString(), 6);
        const duration = BigInt(durationDays * 86400);
        // Also register as subscriber in DataRegistry
        try {
            await this.client.dataRegistry.write.subscribe([publisher]);
        }
        catch {
            // Already subscribed in DataRegistry — continue
        }
        // Approve USDC for escrow deposit
        // Use mock USDC address — in production, read from config
        // For now, approve StreamSubscription to pull budget
        const tx = await this.client.streamSubscription.write.subscribe([
            publisher, budget, maxFee, duration,
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
     * Unsubscribe from a publisher. Returns remaining escrow minus
     * termination fee (5%, waived if expired or publisher abandoned).
     */
    async unsubscribe(publisher) {
        const tx = await this.client.streamSubscription.write.unsubscribe([publisher]);
        const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash: tx });
        return {
            hash: tx,
            status: receipt.status === 'success' ? 'success' : 'reverted',
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed,
        };
    }
    /**
     * Get subscription details for a publisher.
     */
    async getSubscription(publisher) {
        const addr = this.client.account;
        const raw = await this.client.streamSubscription.read.getSubscription([addr, publisher]);
        const remaining = await this.client.streamSubscription.read.remainingBudget([addr, publisher]);
        return {
            active: raw.active,
            budget: raw.budget,
            spent: raw.spent,
            maxFeePerMessage: raw.maxFeePerMessage,
            startTime: Number(raw.startTime),
            duration: Number(raw.duration),
            remaining,
        };
    }
    /**
     * Check if subscription is active.
     */
    async isActive(publisher) {
        const addr = this.client.account;
        return await this.client.streamSubscription.read.isActive([addr, publisher]);
    }
    /**
     * Stream incoming messages. Watches DataStreamed events for this subscriber.
     * Returns an async iterator of messages.
     */
    async *stream(publisher) {
        const addr = this.client.account;
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
                    ],
                }],
            args: {
                subscriber: addr,
                ...(publisher ? { publisher } : {}),
            },
            onLogs: () => { }, // Handled by polling below
        });
        // Poll-based approach for compatibility
        let lastBlock = await this.client.publicClient.getBlockNumber();
        try {
            while (true) {
                await new Promise(r => setTimeout(r, 2000)); // 2s polling interval
                const currentBlock = await this.client.publicClient.getBlockNumber();
                if (currentBlock <= lastBlock)
                    continue;
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
                    const args = log.args;
                    yield {
                        publisher: args.publisher,
                        subscriber: args.subscriber,
                        payloadHash: args.payloadHash,
                        payloadLength: Number(args.payloadLength),
                        fee: args.subscriberFee,
                        timestamp: Number(args.timestamp),
                    };
                }
                lastBlock = currentBlock;
            }
        }
        finally {
            unwatch();
        }
    }
    /**
     * File a dispute flag against a publisher.
     */
    async flag(publisher, flagType, messageHash) {
        // Approve USDC + PPB for flag bond
        // Bond amounts depend on flag type — contract handles validation
        const tx = await this.client.reputationEngine.write.fileFlag([
            publisher, messageHash, FLAG_MAP[flagType],
        ]);
        const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash: tx });
        return {
            hash: tx,
            status: receipt.status === 'success' ? 'success' : 'reverted',
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed,
        };
    }
}
//# sourceMappingURL=subscriber.js.map