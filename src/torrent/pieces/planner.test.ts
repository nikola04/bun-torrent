import { describe, expect, test } from 'bun:test';

import type { TorrentMetadata } from '@torrent/types';
import { createPiecePlanner } from './planner';
import { PiecePlannerError, PiecePlannerErrorCode } from './planner.error';
import { getPieceLength, isValidBlockForRequest, splitPieceIntoRequests } from './utils';

const makeMetadata = ({
    length = 1_000,
    pieceLength = 256,
    pieces = 4,
}: {
    length?: number;
    pieceLength?: number;
    pieces?: number;
} = {}): TorrentMetadata => ({
    announceList: [],
    infoHash: new Uint8Array(20),
    name: 'file.bin',
    pieceLength,
    pieces: Array.from({ length: pieces }, (_, index) => new Uint8Array(20).fill(index)),
    length,
    files: [{ path: ['file.bin'], length, offset: 0 }],
});

const expectPlannerError = (callback: () => unknown, code: PiecePlannerErrorCode): void => {
    try {
        callback();
        throw new Error('Expected callback to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(PiecePlannerError);
        expect((error as PiecePlannerError).code).toBe(code);
    }
};

describe('piece planner utils', () => {
    test('gets regular and final piece lengths', () => {
        const metadata = makeMetadata();

        expect(getPieceLength(metadata, 0)).toBe(256);
        expect(getPieceLength(metadata, 1)).toBe(256);
        expect(getPieceLength(metadata, 2)).toBe(256);
        expect(getPieceLength(metadata, 3)).toBe(232);
    });

    test('rejects invalid piece indexes', () => {
        const metadata = makeMetadata();

        expectPlannerError(
            () => getPieceLength(metadata, -1),
            PiecePlannerErrorCode.INVALID_PIECE_INDEX,
        );
        expectPlannerError(
            () => getPieceLength(metadata, 4),
            PiecePlannerErrorCode.INVALID_PIECE_INDEX,
        );
    });

    test('splits a piece into block requests', () => {
        expect(
            splitPieceIntoRequests({
                pieceIndex: 3,
                pieceLength: 40_000,
                blockLength: 16_384,
            }),
        ).toEqual([
            { type: 'request', pieceIndex: 3, offset: 0, length: 16_384 },
            { type: 'request', pieceIndex: 3, offset: 16_384, length: 16_384 },
            { type: 'request', pieceIndex: 3, offset: 32_768, length: 7_232 },
        ]);
    });

    test('rejects invalid piece and block lengths', () => {
        expectPlannerError(
            () => splitPieceIntoRequests({ pieceIndex: 0, pieceLength: 0 }),
            PiecePlannerErrorCode.INVALID_PIECE_LENGTH,
        );
        expectPlannerError(
            () => splitPieceIntoRequests({ pieceIndex: 0, pieceLength: 10, blockLength: 0 }),
            PiecePlannerErrorCode.INVALID_BLOCK_LENGTH,
        );
    });

    test('checks whether a block satisfies a request', () => {
        const request = { type: 'request' as const, pieceIndex: 1, offset: 4, length: 3 };

        expect(
            isValidBlockForRequest(
                { type: 'piece', pieceIndex: 1, offset: 4, block: new Uint8Array(3) },
                request,
            ),
        ).toBe(true);
        expect(
            isValidBlockForRequest(
                { type: 'piece', pieceIndex: 1, offset: 5, block: new Uint8Array(3) },
                request,
            ),
        ).toBe(false);
        expect(
            isValidBlockForRequest(
                { type: 'piece', pieceIndex: 1, offset: 4, block: new Uint8Array(2) },
                request,
            ),
        ).toBe(false);
    });
});

describe('DefaultPiecePlanner', () => {
    test('tracks totals and initial progress', () => {
        const planner = createPiecePlanner(
            makeMetadata({ length: 10, pieceLength: 4, pieces: 3 }),
            {
                blockLength: 2,
            },
        );

        expect(planner.totalPieces).toBe(3);
        expect(planner.completedPieces).toBe(0);
        expect(planner.complete).toBe(false);
        expect(planner.getProgress(0)).toEqual({
            pieceIndex: 0,
            length: 4,
            receivedBytes: 0,
            status: 'missing',
        });
    });

    test('returns the next missing request and respects availability', () => {
        const planner = createPiecePlanner(makeMetadata({ length: 8, pieceLength: 4, pieces: 2 }), {
            blockLength: 2,
        });

        expect(
            planner.nextRequest({
                hasPiece: (pieceIndex) => pieceIndex === 1,
            }),
        ).toEqual({ type: 'request', pieceIndex: 1, offset: 0, length: 2 });

        const request = planner.nextRequest();
        expect(request).toEqual({ type: 'request', pieceIndex: 0, offset: 0, length: 2 });

        planner.markPending(request!);
        expect(planner.nextRequest()).toEqual({
            type: 'request',
            pieceIndex: 0,
            offset: 2,
            length: 2,
        });
    });

    test('resets pending requests', () => {
        const planner = createPiecePlanner(makeMetadata({ length: 4, pieceLength: 4, pieces: 1 }), {
            blockLength: 2,
        });
        const first = planner.nextRequest()!;
        const second = { type: 'request' as const, pieceIndex: 0, offset: 2, length: 2 };

        planner.markPending(first);
        planner.markPending(second);
        expect(planner.nextRequest()).toBeUndefined();

        planner.resetPending(first);
        expect(planner.nextRequest()).toEqual(first);

        planner.markPending(first);
        planner.resetPeerRequests([first, second]);
        expect(planner.nextRequest()).toEqual(first);
    });

    test('ignores blocks that were not requested', () => {
        const planner = createPiecePlanner(makeMetadata({ length: 4, pieceLength: 4, pieces: 1 }), {
            blockLength: 4,
        });

        expect(
            planner.receiveBlock({
                type: 'piece',
                pieceIndex: 0,
                offset: 0,
                block: new Uint8Array([1, 2, 3, 4]),
            }),
        ).toBeUndefined();
        expect(planner.getProgress(0).receivedBytes).toBe(0);
    });

    test('returns completion after all blocks in a piece are received', () => {
        const planner = createPiecePlanner(makeMetadata({ length: 4, pieceLength: 4, pieces: 1 }), {
            blockLength: 2,
        });
        const first = planner.nextRequest()!;
        planner.markPending(first);
        const second = planner.nextRequest()!;
        planner.markPending(second);

        expect(
            planner.receiveBlock({
                type: 'piece',
                pieceIndex: 0,
                offset: 0,
                block: new Uint8Array([1, 2]),
            }),
        ).toBeUndefined();

        const completion = planner.receiveBlock({
            type: 'piece',
            pieceIndex: 0,
            offset: 2,
            block: new Uint8Array([3, 4]),
        });

        expect(completion).toEqual({
            pieceIndex: 0,
            data: new Uint8Array([1, 2, 3, 4]),
            expectedHash: new Uint8Array(20),
        });
        expect(planner.complete).toBe(true);
        expect(planner.completedPieces).toBe(1);
        expect(planner.getProgress(0)).toEqual({
            pieceIndex: 0,
            length: 4,
            receivedBytes: 4,
            status: 'complete',
        });
    });

    test('resets a completed piece for retry', () => {
        const planner = createPiecePlanner(makeMetadata({ length: 4, pieceLength: 4, pieces: 1 }), {
            blockLength: 2,
        });
        const first = planner.nextRequest()!;
        planner.markPending(first);
        const second = planner.nextRequest()!;
        planner.markPending(second);
        planner.receiveBlock({
            type: 'piece',
            pieceIndex: 0,
            offset: 0,
            block: new Uint8Array([1, 2]),
        });
        planner.receiveBlock({
            type: 'piece',
            pieceIndex: 0,
            offset: 2,
            block: new Uint8Array([3, 4]),
        });

        planner.resetPiece(0);

        expect(planner.complete).toBe(false);
        expect(planner.completedPieces).toBe(0);
        expect(planner.getProgress(0)).toEqual({
            pieceIndex: 0,
            length: 4,
            receivedBytes: 0,
            status: 'missing',
        });
        expect(planner.nextRequest()).toEqual(first);
    });

    test('resets a partially received piece for retry', () => {
        const planner = createPiecePlanner(makeMetadata({ length: 4, pieceLength: 4, pieces: 1 }), {
            blockLength: 2,
        });
        const first = planner.nextRequest()!;
        planner.markPending(first);
        planner.receiveBlock({
            type: 'piece',
            pieceIndex: 0,
            offset: 0,
            block: new Uint8Array([1, 2]),
        });

        planner.resetPiece(0);

        expect(planner.getProgress(0).receivedBytes).toBe(0);
        expect(planner.nextRequest()).toEqual(first);
    });

    test('throws planner errors for invalid piece indexes', () => {
        const planner = createPiecePlanner(makeMetadata({ length: 4, pieceLength: 4, pieces: 1 }));

        expectPlannerError(() => planner.getProgress(1), PiecePlannerErrorCode.INVALID_PIECE_INDEX);
        expectPlannerError(() => planner.resetPiece(1), PiecePlannerErrorCode.INVALID_PIECE_INDEX);
    });
});
