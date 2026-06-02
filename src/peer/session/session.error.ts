import { BunTorrentError } from '../../utils/errors';

/** Error codes set on {@link PeerSessionError.code}. */
export enum PeerSessionErrorCode {
    /** The session was closed before or during the operation. */
    CLOSED = 'PEER_SESSION_CLOSED',
    /** The TCP connect or handshake exceeded `peerConnectTimeoutMs`. */
    CONNECT_TIMEOUT = 'PEER_SESSION_CONNECT_TIMEOUT',
    /** The peer's handshake info hash did not match the torrent's info hash. */
    INFO_HASH_MISMATCH = 'PEER_SESSION_INFO_HASH_MISMATCH',
    /** The socket closed before a full handshake was received. */
    SOCKET_CLOSED_BEFORE_HANDSHAKE = 'PEER_SESSION_SOCKET_CLOSED_BEFORE_HANDSHAKE',
    /** Lower-level socket error (e.g. ECONNREFUSED, ECONNRESET). See `cause`. */
    SOCKET_ERROR = 'PEER_SESSION_SOCKET_ERROR',
}

/**
 * Errors thrown by an individual peer session.
 *
 * Surfaced as `causes` entries on {@link PeerPoolError} when the pool fails to reach
 * its connection target.
 */
export class PeerSessionError extends BunTorrentError {
    constructor(
        code: PeerSessionErrorCode,
        message: string,
        /** Underlying error (typically a Node `net.Socket` error). */
        public override readonly cause?: unknown,
    ) {
        super(message, code);
    }
}
