import { BunTorrentError } from '../../utils/errors';

/** Error codes set on {@link PiecePlannerError.code}. */
export enum PiecePlannerErrorCode {
    /** Attempted to assemble a piece before every block was received. */
    INCOMPLETE_PIECE = 'PIECE_PLANNER_INCOMPLETE_PIECE',
    /** Block length is non-positive or larger than the piece length. */
    INVALID_BLOCK_LENGTH = 'PIECE_PLANNER_INVALID_BLOCK_LENGTH',
    /** Piece index is outside the torrent's piece range. */
    INVALID_PIECE_INDEX = 'PIECE_PLANNER_INVALID_PIECE_INDEX',
    /** Computed piece length is non-positive or invalid for the torrent metadata. */
    INVALID_PIECE_LENGTH = 'PIECE_PLANNER_INVALID_PIECE_LENGTH',
}

/** Errors thrown by the piece scheduler. Mostly indicate invariant violations or bad inputs. */
export class PiecePlannerError extends BunTorrentError {
    constructor(
        code: PiecePlannerErrorCode,
        message: string,
        /** Piece index involved in the failure, when applicable. */
        public readonly pieceIndex?: number,
    ) {
        super(message, code);
    }
}
