import { BunTorrentError } from '@utils/errors';

export enum PeerMessageErrorCode {
    INVALID_LENGTH_PREFIX = 'PEER_MSG_INVALID_LENGTH_PREFIX',
    INVALID_MESSAGE_LENGTH = 'PEER_MSG_INVALID_MESSAGE_LENGTH',
    INVALID_PAYLOAD_LENGTH = 'PEER_MSG_INVALID_PAYLOAD_LENGTH',
    INVALID_UINT32 = 'PEER_MSG_INVALID_UINT32',
    UNKNOWN_MESSAGE_ID = 'PEER_MSG_UNKNOWN_MESSAGE_ID',
    UNSUPPORTED_MESSAGE = 'PEER_MSG_UNSUPPORTED_MESSAGE',
}

export class PeerMessageError extends BunTorrentError {
    constructor(code: PeerMessageErrorCode, message: string) {
        super(message, code);
    }
}
