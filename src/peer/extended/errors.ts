import { BunTorrentError } from '../../utils/errors';

export enum PeerExtendedErrorCode {
    CONNECTION_CLOSED = 'PEER_EXTENDED_CONNECTION_CLOSED',
    CONNECTION_TIMEOUT = 'PEER_EXTENDED_CONNECTION_TIMEOUT',
    INFO_HASH_MISMATCH = 'PEER_EXTENDED_INFO_HASH_MISMATCH',
    INVALID_HANDSHAKE = 'PEER_EXTENDED_INVALID_HANDSHAKE',
    INVALID_METADATA = 'PEER_EXTENDED_INVALID_METADATA',
    METADATA_HASH_MISMATCH = 'PEER_EXTENDED_METADATA_HASH_MISMATCH',
    UNSUPPORTED_UT_METADATA = 'PEER_EXTENDED_UNSUPPORTED_UT_METADATA',
}

export class PeerExtendedError extends BunTorrentError {
    constructor(
        code: PeerExtendedErrorCode,
        message: string,
        public override readonly cause?: unknown,
    ) {
        super(message, code);
    }
}
