export { parseTorrent } from './parser/index';
export { computeInfoHash } from './parser/info-hash';
export { Torrent, TorrentState } from './session/index';
export {
    getSelectedPieceIndexes,
    getTorrentFilePathKey,
    getUnknownSelectedFiles,
    normalizeTorrentFileSelection,
} from './file-selection';
export { DownloadManager } from './download';
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
export {
    planPieceWrites,
    TorrentStorageError,
    TorrentStorageErrorCode,
    writePiece,
    writeValidatedPiece,
} from './storage';

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
export type {
    DownloadManagerOptions,
    DownloadProgress,
    DownloadProgressEventMode,
    DownloadProgressListener,
    PeerDownloadStats,
} from './download';
export type { TorrentFileSelection } from './file-selection';
export type { FileWrite, WritePieceOptions } from './storage';
export type { TorrentFiles, TorrentStateChange, TorrentStats } from './session/index';
export type { TorrentMetadata } from './types';
