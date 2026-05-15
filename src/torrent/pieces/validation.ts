import { compareBytes } from '@utils/buffers';
import { sha1 } from '@utils/sha1';
import type { PieceCompletion } from './types';

export type PieceValidationResult = {
    pieceIndex: number;
    actualHash: Uint8Array;
    expectedHash: Uint8Array;
    valid: boolean;
};

/**
 * Validate an assembled piece against the expected torrent metadata hash.
 *
 * @param piece - Completed piece returned by the planner.
 * @returns Validation result containing both actual and expected SHA-1 hashes.
 */
export const validatePiece = (piece: PieceCompletion): PieceValidationResult => {
    const actualHash = sha1(piece.data);

    return {
        pieceIndex: piece.pieceIndex,
        actualHash,
        expectedHash: piece.expectedHash,
        valid: compareBytes(actualHash, piece.expectedHash) === 0,
    };
};
