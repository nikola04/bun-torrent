import type { TorrentMetadata } from '@torrent/types';
import type { PieceBlock, PieceBlockRequest } from './types';
import { PiecePlannerError, PiecePlannerErrorCode } from './planner.error';

export const DEFAULT_BLOCK_LENGTH = 16 * 1024;

/**
 * Return the byte length of a piece, including the usually shorter final piece.
 *
 * @param metadata - Parsed torrent metadata.
 * @param pieceIndex - Zero-based piece index.
 * @returns The byte length for the requested piece.
 * @throws {PiecePlannerError} When `pieceIndex` is outside the torrent piece range.
 */
export const getPieceLength = (metadata: TorrentMetadata, pieceIndex: number): number => {
    if (!Number.isInteger(pieceIndex) || pieceIndex < 0 || pieceIndex >= metadata.pieces.length) {
        throw new PiecePlannerError(
            PiecePlannerErrorCode.INVALID_PIECE_INDEX,
            `Unknown piece index: ${pieceIndex}`,
            pieceIndex,
        );
    }

    if (pieceIndex === metadata.pieces.length - 1)
        return metadata.length - pieceIndex * metadata.pieceLength;
    return metadata.pieceLength;
};

/**
 * Split one piece into protocol request messages with a fixed maximum block size.
 *
 * @param pieceIndex - Zero-based piece index.
 * @param pieceLength - Total byte length of the piece being split.
 * @param blockLength - Maximum bytes per request. Defaults to `DEFAULT_BLOCK_LENGTH`.
 * @returns Request messages that cover the piece in order.
 * @throws {PiecePlannerError} When `pieceLength` or `blockLength` is not a positive integer.
 */
export const splitPieceIntoRequests = ({
    pieceIndex,
    pieceLength,
    blockLength = DEFAULT_BLOCK_LENGTH,
}: {
    pieceIndex: number;
    pieceLength: number;
    blockLength?: number;
}): PieceBlockRequest[] => {
    if (!Number.isInteger(pieceLength) || pieceLength <= 0) {
        throw new PiecePlannerError(
            PiecePlannerErrorCode.INVALID_PIECE_LENGTH,
            `Piece length must be a positive integer: ${pieceLength}`,
            pieceIndex,
        );
    }

    if (!Number.isInteger(blockLength) || blockLength <= 0) {
        throw new PiecePlannerError(
            PiecePlannerErrorCode.INVALID_BLOCK_LENGTH,
            `Block length must be a positive integer: ${blockLength}`,
            pieceIndex,
        );
    }

    const n = Math.ceil(pieceLength / blockLength);
    const blocks = new Array<PieceBlockRequest>(n);
    for (let i = 0; i < n; i++)
        blocks[i] = {
            type: 'request',
            pieceIndex,
            offset: blockLength * i,
            length: i === n - 1 ? pieceLength - blockLength * i : blockLength,
        };
    return blocks;
};

/**
 * Check whether a received block exactly satisfies a pending request.
 *
 * @param block - Received peer piece message.
 * @param request - Request the block is expected to satisfy.
 * @returns True when piece index, offset, and byte length all match.
 */
export const isValidBlockForRequest = (block: PieceBlock, request: PieceBlockRequest): boolean =>
    block.pieceIndex === request.pieceIndex &&
    block.offset === request.offset &&
    block.block.byteLength === request.length;
