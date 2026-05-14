import { BunTorrentError } from '@utils/errors';

export enum PeerSessionErrorCode {
    CLOSED = 'PEER_SESSION_CLOSED',
    CONNECT_TIMEOUT = 'PEER_SESSION_CONNECT_TIMEOUT',
    INFO_HASH_MISMATCH = 'PEER_SESSION_INFO_HASH_MISMATCH',
    SOCKET_CLOSED_BEFORE_HANDSHAKE = 'PEER_SESSION_SOCKET_CLOSED_BEFORE_HANDSHAKE',
    SOCKET_ERROR = 'PEER_SESSION_SOCKET_ERROR',
}

export class PeerSessionError extends BunTorrentError {
    constructor(
        code: PeerSessionErrorCode,
        message: string,
        public override readonly cause?: unknown,
    ) {
        super(message, code);
    }
}
