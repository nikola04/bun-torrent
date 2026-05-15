import type { TorrentMetadata } from '@torrent/types';
import type {
    BlockState,
    PieceAvailability,
    PieceBlock,
    PieceBlockRequest,
    PieceCompletion,
    PiecePlanner,
    PiecePlannerOptions,
    PieceProgress,
    PlannedPiece,
} from './types';
import { getPieceLength, isValidBlockForRequest, splitPieceIntoRequests } from './utils';
import { concatBytes } from '@utils/buffers';
import { PiecePlannerError, PiecePlannerErrorCode } from './planner.error';

/**
 * In-memory piece planner that schedules block requests and assembles completed pieces.
 */
export class DefaultPiecePlanner implements PiecePlanner {
    private pieces: PlannedPiece[];
    private completed = new Set<number>();

    /**
     * Build an initial missing-block plan from torrent metadata.
     *
     * @param metadata - Parsed torrent metadata containing piece hashes and sizes.
     * @param options - Planner options, including optional block size.
     * @throws {PiecePlannerError} When piece or block sizing is invalid.
     */
    constructor(metadata: TorrentMetadata, options: PiecePlannerOptions) {
        this.pieces = metadata.pieces.map((expectedHash, pieceIndex) => {
            const length = getPieceLength(metadata, pieceIndex);
            return {
                pieceIndex,
                expectedHash,
                length,
                blocks: splitPieceIntoRequests({
                    pieceIndex,
                    pieceLength: length,
                    blockLength: options.blockLength,
                }).map((request) => ({
                    request,
                    status: 'missing',
                    data: undefined,
                })),
            };
        });
    }

    get complete(): boolean {
        return this.completed.size === this.pieces.length;
    }

    get completedPieces(): number {
        return this.completed.size;
    }

    get totalPieces(): number {
        return this.pieces.length;
    }

    /**
     * Return internal state for a piece.
     *
     * @param pieceIndex - Zero-based piece index.
     * @returns Planned piece state.
     * @throws {PiecePlannerError} When `pieceIndex` is outside the torrent piece range.
     */
    private getPiece(pieceIndex: number): PlannedPiece {
        const piece = this.pieces[pieceIndex];
        if (!piece) {
            throw new PiecePlannerError(
                PiecePlannerErrorCode.INVALID_PIECE_INDEX,
                `Unknown piece index: ${pieceIndex}`,
                pieceIndex,
            );
        }
        return piece;
    }

    /**
     * Locate the internal block state described by a request.
     *
     * @param request - Block request to look up.
     * @returns Matching block state, or `undefined` when the request is unknown.
     * @throws {PiecePlannerError} When `request.pieceIndex` is invalid.
     */
    private findBlock(request: PieceBlockRequest): BlockState | undefined {
        const piece = this.getPiece(request.pieceIndex);
        return piece.blocks.find(
            (b) => b.request.offset === request.offset && b.request.length === request.length,
        );
    }

    /**
     * Return a progress snapshot for a piece.
     *
     * @param pieceIndex - Zero-based piece index.
     * @returns Progress for the requested piece.
     * @throws {PiecePlannerError} When `pieceIndex` is outside the torrent piece range.
     */
    public getProgress(pieceIndex: number): PieceProgress {
        const piece = this.getPiece(pieceIndex);
        const completed = this.completed.has(pieceIndex);
        const receivedBytes = piece.blocks.reduce<number>(
            (a, b) => a + (b.status === 'received' ? b.request.length : 0),
            0,
        );

        return {
            pieceIndex,
            length: piece.length,
            receivedBytes,
            status: completed
                ? 'complete'
                : piece.blocks.some((b) => b.status === 'pending')
                  ? 'pending'
                  : 'missing',
        };
    }

    /**
     * Pick the next missing block request.
     *
     * @param availablePieces - Optional peer availability filter, usually backed by bitfield/have state.
     * @returns The next request to send, or `undefined` when nothing is currently requestable.
     */
    public nextRequest(availablePieces?: PieceAvailability): PieceBlockRequest | undefined {
        for (const piece of this.pieces) {
            if (this.completed.has(piece.pieceIndex)) continue;
            if (availablePieces && !availablePieces.hasPiece(piece.pieceIndex)) continue;

            const block = piece.blocks.find((b) => b.status === 'missing');
            if (block) return block.request;
        }

        return undefined;
    }

    /**
     * Mark a missing request as in-flight.
     *
     * @param request - Request selected by `nextRequest`.
     * @throws {PiecePlannerError} When `request.pieceIndex` is invalid.
     */
    public markPending(request: PieceBlockRequest): void {
        const block = this.findBlock(request);
        if (!block || block.status !== 'missing') return;

        block.status = 'pending';
    }

    /**
     * Return an in-flight request back to the missing state.
     *
     * @param request - Pending request that timed out or belonged to a disconnected peer.
     * @throws {PiecePlannerError} When `request.pieceIndex` is invalid.
     */
    public resetPending(request: PieceBlockRequest): void {
        const block = this.findBlock(request);
        if (!block || block.status !== 'pending') return;

        block.status = 'missing';
    }

    /**
     * Reset every in-flight request assigned to a disconnected peer.
     *
     * @param requests - Requests previously assigned to the peer.
     * @throws {PiecePlannerError} When any request contains an invalid piece index.
     */
    public resetPeerRequests(requests: Iterable<PieceBlockRequest>): void {
        for (const r of requests) this.resetPending(r);
    }

    /**
     * Concatenate received blocks for a completed piece.
     *
     * @param piece - Planned piece whose blocks should all be received.
     * @returns The assembled piece bytes.
     * @throws {PiecePlannerError} When any block payload is missing.
     */
    private assemblePiece(piece: PlannedPiece): Uint8Array {
        const blocks: Uint8Array[] = [];

        for (const block of piece.blocks) {
            if (!block.data) {
                throw new PiecePlannerError(
                    PiecePlannerErrorCode.INCOMPLETE_PIECE,
                    `Cannot assemble incomplete piece: ${piece.pieceIndex}`,
                    piece.pieceIndex,
                );
            }
            blocks.push(block.data);
        }

        return concatBytes(blocks);
    }

    /**
     * Accept a received block and emit a completed piece once all blocks are present.
     *
     * @param block - Received peer piece message.
     * @returns Completed piece data, or `undefined` if the piece is still incomplete or the block is unknown.
     * @throws {PiecePlannerError} When `block.pieceIndex` is invalid.
     */
    public receiveBlock(block: PieceBlock): PieceCompletion | undefined {
        const piece = this.getPiece(block.pieceIndex);
        const state = piece.blocks.find((b) => isValidBlockForRequest(block, b.request));

        if (!state || state.status !== 'pending') return undefined;

        state.status = 'received';
        state.data = block.block;

        if (!piece.blocks.every((block) => block.status === 'received')) return undefined;

        this.completed.add(piece.pieceIndex);

        return {
            pieceIndex: block.pieceIndex,
            data: this.assemblePiece(piece),
            expectedHash: piece.expectedHash,
        };
    }
}
