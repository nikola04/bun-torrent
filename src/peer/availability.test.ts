import { describe, expect, test } from 'bun:test';

import { createPeerPieceAvailability, PeerPieceAvailability } from './PeerPieceAvailability';

describe('PeerPieceAvailability', () => {
    test('starts with no pieces when no bitfield is provided', () => {
        const availability = new PeerPieceAvailability(3);

        expect(availability.hasPiece(0)).toBe(false);
        expect(availability.hasPiece(1)).toBe(false);
        expect(availability.hasPiece(2)).toBe(false);
        expect(availability.toPieceIndexes()).toEqual([]);
    });

    test('reads peer bitfields using most-significant-bit ordering', () => {
        const availability = new PeerPieceAvailability(10, {
            bitfield: new Uint8Array([0b1010_0001, 0b1000_0000]),
        });

        expect(availability.toPieceIndexes()).toEqual([0, 2, 7, 8]);
        expect(availability.hasPiece(9)).toBe(false);
    });

    test('ignores spare bits beyond totalPieces', () => {
        const availability = createPeerPieceAvailability(3, new Uint8Array([0xff]));

        expect(availability.toPieceIndexes()).toEqual([0, 1, 2]);
        expect(availability.hasPiece(3)).toBe(false);
    });

    test('marks pieces from have messages', () => {
        const availability = new PeerPieceAvailability(4);

        availability.markHave(2);
        availability.markHave(10);
        availability.markHave(-1);

        expect(availability.toPieceIndexes()).toEqual([2]);
    });

    test('replaces availability from a new bitfield', () => {
        const availability = new PeerPieceAvailability(4, {
            bitfield: new Uint8Array([0b1000_0000]),
        });

        availability.setBitfield(new Uint8Array([0b0101_0000]));

        expect(availability.toPieceIndexes()).toEqual([1, 3]);
    });
});
