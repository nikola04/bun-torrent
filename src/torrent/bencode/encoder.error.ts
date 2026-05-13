import { BunTorrentError } from '@utils/errors';

export enum BencodeEncodeErrorCode {
    INVALID_INTEGER = 'BENCODE_ENCODE_INVALID_INTEGER',
    NEGATIVE_ZERO = 'BENCODE_ENCODE_NEGATIVE_ZERO',
    UNSAFE_INTEGER = 'BENCODE_ENCODE_UNSAFE_INTEGER',
    UNSUPPORTED_VALUE = 'BENCODE_ENCODE_UNSUPPORTED_VALUE',
}

export class BencodeEncodeError extends BunTorrentError {
    constructor(code: BencodeEncodeErrorCode, message: string) {
        super(message, code);
    }
}
