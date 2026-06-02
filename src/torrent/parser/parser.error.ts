import { BunTorrentError } from '../../utils/errors';

/** Error codes set on {@link TorrentParseError.code}. */
export enum TorrentParseErrorCode {
    ROOT_NOT_DICT = 'TORRENT_ROOT_NOT_DICT',
    INFO_MISSING = 'TORRENT_INFO_MISSING',
    INFO_NOT_DICT = 'TORRENT_INFO_NOT_DICT',
    FIELD_MISSING = 'TORRENT_FIELD_MISSING',
    FIELD_INVALID = 'TORRENT_FIELD_INVALID',
    FILE_PATH_INVALID = 'TORRENT_FILE_PATH_INVALID',
    PIECES_INVALID = 'TORRENT_PIECES_INVALID',
}

/**
 * Errors thrown while parsing a `.torrent` file or magnet info dictionary.
 *
 * `field` carries a dotted path into the bencoded document for debugging, e.g.
 * `'info.pieces'` or `'files[3].path[0]'`.
 */
export class TorrentParseError extends BunTorrentError {
    constructor(
        code: TorrentParseErrorCode,
        message: string,
        /** Field path inside the torrent dictionary where parsing failed. */
        public readonly field?: string,
    ) {
        super(message, code);
    }
}
