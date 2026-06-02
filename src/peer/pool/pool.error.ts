import { BunTorrentError } from '../../utils/errors';

/** Error codes set on {@link PeerPoolError.code}. */
export enum PeerPoolErrorCode {
    /** A pool option (e.g. `targetConnections`) failed validation. */
    INVALID_OPTION = 'PEER_POOL_INVALID_OPTION',
    /** Every peer attempt failed and the connected count is below `minConnections`. See `causes` for details. */
    NO_CONNECTABLE_PEERS = 'PEER_POOL_NO_CONNECTABLE_PEERS',
    /** No peers were provided and `minConnections` is greater than zero. */
    NO_PEERS = 'PEER_POOL_NO_PEERS',
}

/**
 * Errors thrown by the peer connection pool.
 *
 * Typically reaches the caller as a download-time failure when no peers can be reached
 * and `minConnections` is not zero.
 */
export class PeerPoolError extends BunTorrentError {
    constructor(
        code: PeerPoolErrorCode,
        message: string,
        /** Individual peer connection errors collected during pool ramp-up. */
        public readonly causes: unknown[] = [],
    ) {
        super(message, code);
    }
}
