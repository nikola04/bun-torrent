import { describe, expect, test } from 'bun:test';

import { sha1 } from '../../utils/sha1';
import { validatePiece } from './validation';

describe('validatePiece', () => {
    test('accepts a piece when its SHA-1 hash matches', () => {
        const data = new Uint8Array([1, 2, 3, 4]);
        const result = validatePiece({
            pieceIndex: 2,
            data,
            expectedHash: sha1(data),
        });

        expect(result).toMatchObject({
            pieceIndex: 2,
            valid: true,
        });
        expect(result.actualHash).toEqual(result.expectedHash);
    });

    test('rejects a piece when its SHA-1 hash does not match', () => {
        const result = validatePiece({
            pieceIndex: 1,
            data: new Uint8Array([1, 2, 3, 4]),
            expectedHash: sha1(new Uint8Array([4, 3, 2, 1])),
        });

        expect(result.valid).toBe(false);
        expect(result.actualHash).not.toEqual(result.expectedHash);
    });
});
