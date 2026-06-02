import { BunTorrentError } from './utils/errors';

/** Error codes set on {@link ClientError.code}. */
export enum ClientErrorCode {
    /** {@link Client.download} or {@link Client.inspect} called after {@link Client.close}. */
    CLOSED = 'CLIENT_CLOSED',
    /** `files` option referenced paths that do not exist in the torrent. */
    INVALID_FILE_SELECTION = 'CLIENT_INVALID_FILE_SELECTION',
    /** Torrent file input was neither a string path, `Uint8Array`, nor `ArrayBuffer`. */
    UNSUPPORTED_TORRENT_FILE_INPUT = 'CLIENT_UNSUPPORTED_TORRENT_FILE_INPUT',
}

/**
 * Errors thrown directly by {@link Client}. See {@link ClientErrorCode}.
 *
 * Errors from underlying subsystems (parser, tracker, peer pool, DHT) are thrown as
 * their own classes — this one only wraps client-level failures.
 */
export class ClientError extends BunTorrentError {
    constructor(code: ClientErrorCode, message: string) {
        super(message, code);
    }
}
