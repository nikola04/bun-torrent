import { describe, expect, it } from 'bun:test';

import { DHTError, DHTErrorCode } from './errors';
import {
    DEFAULT_DHT_K_BUCKET_SIZE,
    DHT_K_BUCKET_COUNT,
    DhtRoutingTable,
} from './routing-table';
import type { DhtNode } from './utils/compact';

describe('DhtRoutingTable', () => {
    it('validates constructor options', () => {
        expectDhtError(() => new DhtRoutingTable(new Uint8Array(19)), DHTErrorCode.INVALID_DHT_ID);
        expectDhtError(
            () => new DhtRoutingTable(id(0), { bucketSize: 0 }),
            DHTErrorCode.INVALID_K_BUCKET_SIZE,
        );
    });

    it('calculates K-bucket indexes from xor distance to the local node id', () => {
        const table = new DhtRoutingTable(id(0));

        expect(table.getBucketIndex(id(0, 1))).toBe(0);
        expect(table.getBucketIndex(id(0, 2))).toBe(1);
        expect(table.getBucketIndex(id(0, 0x80))).toBe(7);
        expect(table.getBucketIndex(id(0x80))).toBe(DHT_K_BUCKET_COUNT - 1);
    });

    it('adds, reads and removes nodes by id', () => {
        const table = new DhtRoutingTable(id(0));
        const first = node(id(1), 1);

        expect(table.add(first)).toBe(true);
        expect(table.size).toBe(1);
        expect(table.has(first.id)).toBe(true);
        expect(table.get(first.id)).toEqual(first);

        expect(table.remove(first.id)).toBe(true);
        expect(table.size).toBe(0);
        expect(table.has(first.id)).toBe(false);
        expect(table.remove(first.id)).toBe(false);
    });

    it('ignores the local node id', () => {
        const localId = id(1);
        const table = new DhtRoutingTable(localId);

        expect(table.add(node(localId, 1))).toBe(false);
        expect(table.size).toBe(0);
        expect(table.get(localId)).toBeUndefined();
        expect(table.remove(localId)).toBe(false);
    });

    it('stores clones instead of external node references', () => {
        const table = new DhtRoutingTable(id(0));
        const first = node(id(1), 1);

        expect(table.add(first)).toBe(true);
        first.id[0] = 255;

        const stored = table.get(id(1));
        expect(stored).toEqual(node(id(1), 1));

        stored!.id[0] = 255;
        expect(table.get(id(1))).toEqual(node(id(1), 1));
    });

    it('enforces K-bucket capacity', () => {
        const table = new DhtRoutingTable(id(0), { bucketSize: 2 });

        expect(table.add(node(id(0, 0x80), 1))).toBe(true);
        expect(table.add(node(id(0, 0x81), 2))).toBe(true);
        expect(table.add(node(id(0, 0x82), 3))).toBe(false);
        expect(table.size).toBe(2);
    });

    it('updates an existing node even when the bucket is full', () => {
        const table = new DhtRoutingTable(id(0), { bucketSize: 2 });
        const firstId = id(0, 0x80);

        expect(table.add(node(firstId, 1))).toBe(true);
        expect(table.add(node(id(0, 0x81), 2))).toBe(true);
        expect(table.add({ ...node(firstId, 9), host: '10.0.0.9' })).toBe(true);

        expect(table.size).toBe(2);
        expect(table.get(firstId)).toEqual({ id: firstId, host: '10.0.0.9', port: 6009 });
    });

    it('returns the closest nodes to a lookup target', () => {
        const table = new DhtRoutingTable(id(0));
        const target = id(0);

        table.add(node(id(0, 8), 8));
        table.add(node(id(0, 1), 1));
        table.add(node(id(0, 4), 4));
        table.add(node(id(0x80), 128));

        expect(table.closest(target, 3).map((entry) => entry.port)).toEqual([6001, 6004, 6008]);
    });

    it('returns an empty closest list for non-positive counts', () => {
        const table = new DhtRoutingTable(id(0));
        table.add(node(id(1), 1));

        expect(table.closest(id(0), 0)).toEqual([]);
        expect(table.closest(id(0), -1)).toEqual([]);
    });

    it('uses the default BitTorrent DHT bucket size', () => {
        const table = new DhtRoutingTable(id(0));

        for (let i = 0; i < DEFAULT_DHT_K_BUCKET_SIZE; i++) {
            expect(table.add(node(id(0, 0x80 + i), i))).toBe(true);
        }

        expect(table.add(node(id(0, 0x80 + DEFAULT_DHT_K_BUCKET_SIZE), 99))).toBe(false);
    });
});

const id = (firstByte: number, lastByte = 0): Uint8Array => {
    const bytes = new Uint8Array(20);
    bytes[0] = firstByte;
    bytes[19] = lastByte;
    return bytes;
};

const node = (nodeId: Uint8Array, suffix: number): DhtNode => ({
    id: nodeId,
    host: `10.0.0.${suffix}`,
    port: 6000 + suffix,
});

const expectDhtError = (callback: () => unknown, code: DHTErrorCode): void => {
    try {
        callback();
        throw new Error('Expected callback to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        expect((error as DHTError).code).toBe(code);
    }
};
