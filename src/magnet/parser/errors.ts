import { BunTorrentError } from '../../utils/errors';

/** Error codes set on {@link MagnetParseError.code}. */
export enum MagnetParseErrorCode {
    /** Magnet string is not a valid `magnet:` URI. */
    INVALID_URI = 'INVALID_MAGNET_URI',
    /** The `xt` parameter is missing, has the wrong scheme, or carries a malformed info hash. */
    INVALID_XT = 'INVALID_XT_PARAM',
    /** Magnet had no trackers and no DHT was provided to resolve peers. */
    NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
    /** No peer returned the info dictionary via `ut_metadata` within the timeout. */
    NO_METADATA = 'NO_METADATA',
    /** Info dictionary was received but failed to parse. See `cause`. */
    PARSING_FAILED = 'METADATA_FAILED_TO_PARSE',
}

/**
 * Errors thrown while parsing a magnet URI or fetching its info dictionary from peers.
 *
 * For magnets the parser must discover peers (trackers + DHT) and fetch the info dict
 * via the `ut_metadata` extension; this class covers failures along that pipeline.
 */
export class MagnetParseError extends BunTorrentError {
    constructor(
        code: MagnetParseErrorCode,
        message: string,
        /** Field name involved in the failure, when applicable. */
        public readonly field?: string,
        /** Underlying error (e.g. the bencode parse failure for `PARSING_FAILED`). */
        public override readonly cause?: unknown,
    ) {
        super(message, code);
    }
}
