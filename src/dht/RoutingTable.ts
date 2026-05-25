import { bytesToHex } from '../utils/buffers';
import { DHTError, DHTErrorCode } from './errors';
import { cloneNode, KBucket } from './KBucket';
import type { DhtNode } from './utils/compact';
import { compareDistance, DHT_ID_LENGTH, isDhtId, xorDistance } from './utils/distance';

export const DHT_K_BUCKET_COUNT = DHT_ID_LENGTH * 8;
export const DEFAULT_DHT_K_BUCKET_SIZE = 8;

export type DhtRoutingTableOptions = {
    bucketSize?: number;
};

export class DhtRoutingTable {
    private readonly localNodeId: Uint8Array;
    private readonly buckets: KBucket[];

    constructor(localNodeId: Uint8Array, options: DhtRoutingTableOptions = {}) {
        if (!isDhtId(localNodeId)) {
            throw new DHTError(
                DHTErrorCode.INVALID_DHT_ID,
                `Local DHT node id must be exactly ${DHT_ID_LENGTH} bytes`,
            );
        }

        const bucketSize = options.bucketSize ?? DEFAULT_DHT_K_BUCKET_SIZE;
        if (!Number.isInteger(bucketSize) || bucketSize <= 0) {
            throw new DHTError(
                DHTErrorCode.INVALID_K_BUCKET_SIZE,
                `Invalid K-bucket size: ${bucketSize}`,
            );
        }

        this.localNodeId = localNodeId.slice();
        this.buckets = Array.from({ length: DHT_K_BUCKET_COUNT }, () => new KBucket(bucketSize));
    }

    public get size(): number {
        return this.buckets.reduce((total, bucket) => total + bucket.size, 0);
    }

    public add(node: DhtNode): boolean {
        this.assertNodeId(node.id);

        if (bytesToHex(node.id) === bytesToHex(this.localNodeId)) return false;

        return this.buckets[this.getBucketIndex(node.id)]!.add(cloneNode(node));
    }

    public remove(nodeId: Uint8Array): boolean {
        this.assertNodeId(nodeId);

        if (bytesToHex(nodeId) === bytesToHex(this.localNodeId)) return false;

        return this.buckets[this.getBucketIndex(nodeId)]!.remove(nodeId);
    }

    public has(nodeId: Uint8Array): boolean {
        return this.get(nodeId) !== undefined;
    }

    public get(nodeId: Uint8Array): DhtNode | undefined {
        this.assertNodeId(nodeId);

        if (bytesToHex(nodeId) === bytesToHex(this.localNodeId)) return undefined;

        const node = this.buckets[this.getBucketIndex(nodeId)]!.get(nodeId);
        return node ? cloneNode(node) : undefined;
    }

    public closest(target: Uint8Array, count = DEFAULT_DHT_K_BUCKET_SIZE): DhtNode[] {
        this.assertNodeId(target);

        if (!Number.isInteger(count) || count <= 0) return [];

        return this.buckets
            .flatMap((bucket) => bucket.nodes)
            .sort((left, right) => compareDistance(left.id, right.id, target))
            .slice(0, count)
            .map(cloneNode);
    }

    public getBucketIndex(nodeId: Uint8Array): number {
        this.assertNodeId(nodeId);

        const distance = xorDistance(this.localNodeId, nodeId);

        for (let byteIndex = 0; byteIndex < distance.byteLength; byteIndex++) {
            const byte = distance[byteIndex]!;
            if (byte === 0) continue;

            const leadingZeroBits = Math.clz32(byte) - 24;
            const leadingZeroDistanceBits = byteIndex * 8 + leadingZeroBits;
            return DHT_K_BUCKET_COUNT - leadingZeroDistanceBits - 1;
        }

        throw new DHTError(
            DHTErrorCode.INVALID_DHT_ID,
            'Cannot calculate bucket index for local node id',
        );
    }

    private assertNodeId(nodeId: Uint8Array): void {
        if (!isDhtId(nodeId)) {
            throw new DHTError(
                DHTErrorCode.INVALID_DHT_ID,
                `DHT node id must be exactly ${DHT_ID_LENGTH} bytes`,
            );
        }
    }
}
