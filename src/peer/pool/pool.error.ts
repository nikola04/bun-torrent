import { BunTorrentError } from '@utils/errors';

export enum PeerPoolErrorCode {
    INVALID_OPTION = 'PEER_POOL_INVALID_OPTION',
    NO_CONNECTABLE_PEERS = 'PEER_POOL_NO_CONNECTABLE_PEERS',
    NO_PEERS = 'PEER_POOL_NO_PEERS',
}

export class PeerPoolError extends BunTorrentError {
    constructor(
        code: PeerPoolErrorCode,
        message: string,
        public readonly causes: unknown[] = [],
    ) {
        super(message, code);
    }
}
