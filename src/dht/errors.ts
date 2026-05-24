import { BunTorrentError } from '../utils/errors';

export enum DHTErrorCode {
    DHT_BOOTSTRAP_FAILED = 'DHT_BOOTSTRAP_FAILED',
    DHT_CLIENT_CLOSED = 'DHT_CLIENT_CLOSED',
    DHT_QUERY_FAILED = 'DHT_QUERY_FAILED',
    DHT_QUERY_TIMEOUT = 'DHT_QUERY_TIMEOUT',
    DISTANCE_INVALID_LENGTHS = 'XOR_DISTANCE_INVALID_LENGTHS',
    INVALID_COMPACT_PEER = 'INVALID_COMPACT_PEER',
    INVALID_COMPACT_NODE = 'INVALID_COMPACT_NODE',
    INVALID_DHT_ID = 'INVALID_DHT_ID',
    INVALID_IPV4_HOST = 'INVALID_IPV4_HOST',
    INVALID_K_BUCKET_SIZE = 'INVALID_K_BUCKET_SIZE',
    INVALID_KRPC_MESSAGE = 'INVALID_KRPC_MESSAGE',
    INVALID_PORT = 'INVALID_PORT',
}

export class DHTError extends BunTorrentError {
    constructor(
        code: DHTErrorCode,
        message: string,
        public readonly causes: unknown[] = [],
    ) {
        super(message, code);
    }
}
