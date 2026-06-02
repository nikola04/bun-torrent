import { BunTorrentError } from '../utils/errors';

/** Error codes set on {@link TrackerError.code}. */
export enum TrackerErrorCode {
    ANNOUNCE_FAILED = 'TRACKER_ANNOUNCE_FAILED',
    ANNOUNCE_RESPONSE_TOO_SHORT = 'TRACKER_ANNOUNCE_RESPONSE_TOO_SHORT',
    ANNOUNCE_TIMEOUT = 'TRACKER_ANNOUNCE_TIMEOUT',
    CONNECT_RESPONSE_TOO_SHORT = 'TRACKER_CONNECT_RESPONSE_TOO_SHORT',
    FAILURE_RESPONSE = 'TRACKER_FAILURE_RESPONSE',
    HTTP_REQUEST_FAILED = 'TRACKER_HTTP_REQUEST_FAILED',
    HTTP_RESPONSE_INVALID = 'TRACKER_HTTP_RESPONSE_INVALID',
    INVALID_ACTION = 'TRACKER_INVALID_ACTION',
    INVALID_PORT = 'TRACKER_INVALID_PORT',
    NO_PEERS = 'TRACKER_NO_PEERS',
    NO_SUPPORTED_TRACKERS = 'TRACKER_NO_SUPPORTED_TRACKERS',
    TRANSACTION_ID_MISMATCH = 'TRACKER_TRANSACTION_ID_MISMATCH',
}

/**
 * Errors thrown by HTTP and UDP tracker announce flows.
 *
 * Most tracker failures are non-fatal at the {@link Client} level: when a tracker
 * returns no peers, times out, or is unreachable, the client falls back to DHT.
 * The error still surfaces here for callers that use the tracker functions directly.
 */
export class TrackerError extends BunTorrentError {
    constructor(
        code: TrackerErrorCode,
        message: string,
        /** Underlying errors that caused this failure (e.g. network errors, multiple tracker attempts). */
        public readonly causes: unknown[] = [],
    ) {
        super(message, code);
    }
}
