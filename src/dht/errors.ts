import { BunTorrentError } from '../utils/errors';

export enum DHTErrorCode {
    DISTANCE_INVALID_LENGTHS = 'XOR_DISTANCE_INVALID_LENGTHS'
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
