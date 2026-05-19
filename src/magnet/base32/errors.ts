import { BunTorrentError } from '../../utils/errors';

export enum Base32DecoderErrorCode {
    INVALID_CHAR = 'INVALID_BASE32_CHAR',
}

export class Base32DecoderError extends BunTorrentError {
    constructor(
        code: Base32DecoderErrorCode,
        message: string,
        public readonly field?: string,
    ) {
        super(message, code);
    }
}
