import { BunTorrentError } from '../../utils/errors';

/** Error codes set on {@link TorrentStorageError.code}. */
export enum TorrentStorageErrorCode {
    /** File offsets in metadata do not cover the piece byte range. */
    INVALID_FILE_LAYOUT = 'TORRENT_STORAGE_INVALID_FILE_LAYOUT',
    /** Piece index is outside the torrent's piece range. */
    INVALID_PIECE_INDEX = 'TORRENT_STORAGE_INVALID_PIECE_INDEX',
    /** Piece data length does not match the expected length for this piece. */
    INVALID_PIECE_LENGTH = 'TORRENT_STORAGE_INVALID_PIECE_LENGTH',
    /** A file path contains a forbidden segment (empty, `.`, `..`, or path separators). */
    INVALID_FILE_PATH = 'TORRENT_STORAGE_INVALID_FILE_PATH',
}

/** Errors thrown while writing validated pieces to disk. */
export class TorrentStorageError extends BunTorrentError {
    constructor(
        code: TorrentStorageErrorCode,
        message: string,
        /** Piece index involved in the failure, when applicable. */
        public readonly pieceIndex?: number,
    ) {
        super(message, code);
    }
}
