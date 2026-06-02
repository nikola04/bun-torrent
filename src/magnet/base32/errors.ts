import { BunTorrentError } from '../../utils/errors';

/** Error codes set on {@link Base32DecoderError.code}. */
export enum Base32DecoderErrorCode {
    /** Input contained a character outside the base32 alphabet. */
    INVALID_CHAR = 'INVALID_BASE32_CHAR',
}

/**
 * Errors from base32 decoding of magnet info hashes (BEP 9 short form, 32 chars).
 *
 * Surfaces during {@link parseMagnetURI} when the `xt` info hash uses base32 instead of hex.
 */
export class Base32DecoderError extends BunTorrentError {
    constructor(
        code: Base32DecoderErrorCode,
        message: string,
        /** Optional field path for context. */
        public readonly field?: string,
    ) {
        super(message, code);
    }
}
