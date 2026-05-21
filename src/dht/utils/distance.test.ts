import { describe, expect, it } from 'bun:test';

import { DHTError, DHTErrorCode } from '../errors';
import { DHT_ID_LENGTH, compareDistance, createDhtNodeId, isDhtId, xorDistance } from './distance';

describe('createDhtNodeId', () => {
    it('creates a 20-byte DHT node id', () => {
        expect(createDhtNodeId()).toHaveLength(DHT_ID_LENGTH);
    });

    it('creates different ids', () => {
        expect([...createDhtNodeId()]).not.toEqual([...createDhtNodeId()]);
    });
});

describe('isDhtId', () => {
    it('accepts 20-byte ids', () => {
        expect(isDhtId(new Uint8Array(20))).toBe(true);
    });

    it('rejects non 20-byte ids', () => {
        expect(isDhtId(new Uint8Array(19))).toBe(false);
        expect(isDhtId(new Uint8Array(21))).toBe(false);
    });
});

describe('xorDistance', () => {
    it('returns the xor distance between two byte arrays', () => {
        expect([
            ...xorDistance(
                new Uint8Array([0b10101010, 0b11110000]),
                new Uint8Array([0b11001100, 0b00001111]),
            ),
        ]).toEqual([0b01100110, 0b11111111]);
    });

    it('rejects byte arrays with different lengths', () => {
        expectDhtError(
            () => xorDistance(new Uint8Array([1]), new Uint8Array([1, 2])),
            DHTErrorCode.DISTANCE_INVALID_LENGTHS,
        );
    });
});

describe('compareDistance', () => {
    it('returns a negative value when the left id is closer to the target', () => {
        expect(compareDistance(bytes([0]), bytes([2]), bytes([0]))).toBeLessThan(0);
    });

    it('returns a positive value when the right id is closer to the target', () => {
        expect(compareDistance(bytes([2]), bytes([0]), bytes([0]))).toBeGreaterThan(0);
    });

    it('returns zero when both ids have the same distance to the target', () => {
        expect(compareDistance(bytes([1]), bytes([1]), bytes([0]))).toBe(0);
    });

    it('compares the full xor distance as an unsigned big-endian byte array', () => {
        const target = bytes([0, 0]);
        const left = bytes([0, 255]);
        const right = bytes([1, 0]);

        expect(compareDistance(left, right, target)).toBeLessThan(0);
    });

    it('can be used to sort ids by distance to target', () => {
        const target = bytes([0]);
        const ids = [bytes([3]), bytes([1]), bytes([2]), bytes([0])];

        ids.sort((a, b) => compareDistance(a, b, target));

        expect(ids.map((id) => id[0])).toEqual([0, 1, 2, 3]);
    });
});

const bytes = (values: number[]): Uint8Array => new Uint8Array(values);

const expectDhtError = (callback: () => unknown, code: DHTErrorCode): void => {
    try {
        callback();
        throw new Error('Expected callback to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        expect((error as DHTError).code).toBe(code);
    }
};
