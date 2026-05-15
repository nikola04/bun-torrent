import { BunTorrentError } from '@utils/errors';

export enum TorrentStorageErrorCode {
    INVALID_FILE_LAYOUT = 'TORRENT_STORAGE_INVALID_FILE_LAYOUT',
    INVALID_PIECE_INDEX = 'TORRENT_STORAGE_INVALID_PIECE_INDEX',
    INVALID_PIECE_LENGTH = 'TORRENT_STORAGE_INVALID_PIECE_LENGTH',
    INVALID_FILE_PATH = 'TORRENT_STORAGE_INVALID_FILE_PATH',
}

export class TorrentStorageError extends BunTorrentError {
    constructor(
        code: TorrentStorageErrorCode,
        message: string,
        public readonly pieceIndex?: number,
    ) {
        super(message, code);
    }
}
