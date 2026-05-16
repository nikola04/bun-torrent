import type { PieceMessage, RequestMessage } from '@peer/messages';

export type PiecePlannerOptions = {
    blockLength?: number;
};

export type PieceBlockRequest = RequestMessage;

export type PieceBlock = PieceMessage;

export type PieceStatus = 'missing' | 'pending' | 'complete';

export type PieceProgress = {
    pieceIndex: number;
    length: number;
    receivedBytes: number;
    status: PieceStatus;
};

export type PiecePlanner = {
    readonly complete: boolean;
    readonly completedPieces: number;
    readonly totalPieces: number;

    getProgress(pieceIndex: number): PieceProgress;
    nextRequest(availablePieces?: PieceAvailability): PieceBlockRequest | undefined;
    markPending(request: PieceBlockRequest): void;
    receiveBlock(block: PieceBlock): PieceCompletion | undefined;
    resetPiece(pieceIndex: number): void;
    resetPending(request: PieceBlockRequest): void;
    resetPeerRequests(requests: Iterable<PieceBlockRequest>): void;
};

export type PieceAvailability = {
    hasPiece(pieceIndex: number): boolean;
};

export type PieceCompletion = {
    pieceIndex: number;
    data: Uint8Array;
    expectedHash: Uint8Array;
};

export type BlockStatus = 'missing' | 'pending' | 'received';

export type BlockState = {
    request: PieceBlockRequest;
    status: BlockStatus;
    data?: Uint8Array;
};

export type PlannedPiece = {
    pieceIndex: number;
    length: number;
    expectedHash: Uint8Array;
    blocks: BlockState[];
};
