import { describe, expect, test } from 'bun:test';

import { PeerExtendedError, PeerExtendedErrorCode } from '../errors';
import { MetadataAssembler, METADATA_PIECE_LENGTH } from './MetadataAssembler';

describe('MetadataAssembler', () => {
    test('tracks missing pieces and assembles metadata bytes', () => {
        const assembler = new MetadataAssembler(METADATA_PIECE_LENGTH + 3);
        const first = new Uint8Array(METADATA_PIECE_LENGTH).fill(1);
        const second = new Uint8Array([2, 3, 4]);

        expect(assembler.totalPieces).toBe(2);
        expect(assembler.complete).toBe(false);
        expect(assembler.missingPieces()).toEqual([0, 1]);

        assembler.addPiece(0, first);
        expect(assembler.missingPieces()).toEqual([1]);

        assembler.addPiece(1, second);
        expect(assembler.complete).toBe(true);
        expect(assembler.assemble()).toEqual(new Uint8Array([...first, ...second]));
    });

    test('rejects invalid piece indexes and lengths', () => {
        const assembler = new MetadataAssembler(METADATA_PIECE_LENGTH + 1);

        expect(() => assembler.addPiece(2, new Uint8Array([1]))).toThrow(PeerExtendedError);

        try {
            assembler.addPiece(0, new Uint8Array([1]));
            throw new Error('Expected addPiece to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(PeerExtendedError);
            expect((error as PeerExtendedError).code).toBe(PeerExtendedErrorCode.INVALID_METADATA);
        }
    });
});
