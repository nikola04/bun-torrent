export { openExtendedConnection } from './connection';
export { PeerExtendedError, PeerExtendedErrorCode } from './errors';
export { fetchMetadataFromPeer } from './metadata';

export type {
    ExtendedConnection,
    ExtendedMessage,
    OpenExtendedConnectionOptions,
} from './connection';
export type { FetchMetadataFromPeerOptions } from './metadata';
