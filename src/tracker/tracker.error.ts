import { BunTorrentError } from '@utils/errors';

export enum TrackerErrorCode {
    ANNOUNCE_RESPONSE_TOO_SHORT = 'TRACKER_ANNOUNCE_RESPONSE_TOO_SHORT',
    ANNOUNCE_TIMEOUT = 'TRACKER_ANNOUNCE_TIMEOUT',
    CONNECT_RESPONSE_TOO_SHORT = 'TRACKER_CONNECT_RESPONSE_TOO_SHORT',
    INVALID_ACTION = 'TRACKER_INVALID_ACTION',
    NO_PEERS = 'TRACKER_NO_PEERS',
    TRANSACTION_ID_MISMATCH = 'TRACKER_TRANSACTION_ID_MISMATCH',
}

export class TrackerError extends BunTorrentError {
    constructor(code: TrackerErrorCode, message: string) {
        super(message, code);
    }
}
