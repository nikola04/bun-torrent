import { BunTorrentError } from '@utils/errors';

export enum BencodeDecodeErrorCode {
    BAD_FORMAT = 'BENCODE_BAD_FORMAT',
    BUFFER_OVERFLOW = 'BENCODE_BUFFER_OVERFLOW',
    EXPECTED_INTEGER = 'BENCODE_EXPECTED_INTEGER',
    MISSING_INTEGER_DIGITS = 'BENCODE_MISSING_INTEGER_DIGITS',
    LEADING_ZERO = 'BENCODE_LEADING_ZERO',
    NEGATIVE_ZERO = 'BENCODE_NEGATIVE_ZERO',
    UNTERMINATED_INTEGER = 'BENCODE_UNTERMINATED_INTEGER',
    TRAILING_DATA = 'BENCODE_TRAILING_DATA',
}

export class BencodeDecodeError extends BunTorrentError {
    constructor(
        code: BencodeDecodeErrorCode,
        message: string,
        public readonly offset: number,
    ) {
        super(message, code);
    }
}
