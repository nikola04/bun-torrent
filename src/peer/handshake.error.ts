import { BunTorrentError } from '@utils/errors';

export enum HandshakeErrorCode {
    INFOHASH_INVALID_LENGTH = 'HANDSHK_INFOHASH_INVALID_LENGTH',
    INVALID_LENGTH = 'HANDSHK_INVALID_LENGTH',
    INVALID_PROTOCOL = 'HANDSHK_INVALID_PROTOCOL',
    PEERID_INVALID_LENGTH = 'HANDSHK_PEERID_INVALID_LENGTH',
    RESERVED_INVALID_LENGTH = 'HANDSHK_RESERVED_INVALID_LENGTH',
}

export class PeerHandshakeError extends BunTorrentError {
    constructor(code: HandshakeErrorCode, message: string) {
        super(message, code);
    }
}
