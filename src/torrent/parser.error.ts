import { BunTorrentError } from '@utils/errors';

export enum TorrentParseErrorCode {
    ROOT_NOT_DICT = 'TORRENT_ROOT_NOT_DICT',
    INFO_MISSING = 'TORRENT_INFO_MISSING',
    INFO_NOT_DICT = 'TORRENT_INFO_NOT_DICT',
    FIELD_MISSING = 'TORRENT_FIELD_MISSING',
    FIELD_INVALID = 'TORRENT_FIELD_INVALID',
    PIECES_INVALID = 'TORRENT_PIECES_INVALID',
    MULTI_FILE_UNSUPPORTED = 'TORRENT_MULTI_FILE_UNSUPPORTED',
}

export class TorrentParseError extends BunTorrentError {
    constructor(
        code: TorrentParseErrorCode,
        message: string,
        public readonly field?: string,
    ) {
        super(message, code);
    }
}
