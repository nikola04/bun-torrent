export { parseTorrent } from './parser/index';
export { computeInfoHash } from './parser/info-hash';
export { Torrent } from './session/index';
export {
    DEFAULT_BLOCK_LENGTH,
    createPiecePlanner,
    getPieceLength,
    isValidBlockForRequest,
    PiecePlannerError,
    PiecePlannerErrorCode,
    splitPieceIntoRequests,
    validatePiece,
} from './pieces';

export { decodeBencode, encodeBencode, toBValue } from './bencode';
export {
    BencodeDecodeError,
    BencodeDecodeErrorCode,
    BencodeEncodeError,
    BencodeEncodeErrorCode,
} from './bencode';
export { TorrentParseError, TorrentParseErrorCode } from './parser/parser.error';

export type { BBytes, BDict, BInteger, BList, BValue, BencodeInput } from './bencode';
export type {
    PieceAvailability,
    PieceBlock,
    PieceBlockRequest,
    PieceCompletion,
    PiecePlanner,
    PiecePlannerOptions,
    PieceProgress,
    PieceStatus,
    PieceValidationResult,
} from './pieces';
export type { TorrentStats } from './session/index';
export type { TorrentMetadata } from './types';
