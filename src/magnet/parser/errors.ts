import { BunTorrentError } from '../../utils/errors';

export enum MagnetParseErrorCode {
    INVALID_URI = 'INVALID_MAGNET_URI',
    INVALID_XT = 'INVALID_XT_PARAM',
    NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
    NO_METADATA = 'NO_METADATA',
    PARSING_FAILED = 'METADATA_FAILED_TO_PARSE',
}

export class MagnetParseError extends BunTorrentError {
    constructor(
        code: MagnetParseErrorCode,
        message: string,
        public readonly field?: string,
    ) {
        super(message, code);
    }
}
