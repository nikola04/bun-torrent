import { BunTorrentError } from '@utils/errors';

export enum PiecePlannerErrorCode {
    INCOMPLETE_PIECE = 'PIECE_PLANNER_INCOMPLETE_PIECE',
    INVALID_BLOCK_LENGTH = 'PIECE_PLANNER_INVALID_BLOCK_LENGTH',
    INVALID_PIECE_INDEX = 'PIECE_PLANNER_INVALID_PIECE_INDEX',
    INVALID_PIECE_LENGTH = 'PIECE_PLANNER_INVALID_PIECE_LENGTH',
}

export class PiecePlannerError extends BunTorrentError {
    constructor(
        code: PiecePlannerErrorCode,
        message: string,
        public readonly pieceIndex?: number,
    ) {
        super(message, code);
    }
}
