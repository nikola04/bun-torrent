/**
 * Copyright (c) 2026 Nikola Nedeljkovic
 * SPDX-License-Identifier: MIT
 */

export { Client, DownloadState, TorrentClient } from './client';
export { ClientError, ClientErrorCode } from './client.error';
export type { ClientConfig, DownloadOptions, TorrentFileInput } from './client';

export {
    Torrent,
    TorrentState,
    TorrentParseError,
    TorrentParseErrorCode,
    TorrentStorageError,
    TorrentStorageErrorCode,
    PiecePlannerError,
    PiecePlannerErrorCode,
} from './torrent/index';

export {
    MagnetParseError,
    MagnetParseErrorCode,
    Base32DecoderError,
    Base32DecoderErrorCode,
} from './magnet';

export { PeerPoolError, PeerPoolErrorCode, PeerSessionError, PeerSessionErrorCode } from './peer';
export { TrackerError, TrackerErrorCode } from './tracker';

export type {
    DownloadProgress,
    DownloadProgressEventMode,
    TorrentFileSelection,
    TorrentFiles,
    TorrentMetadata,
    TorrentStats,
    TorrentStateChange,
} from './torrent/index';
export type { TorrentFile } from './torrent/types';

export { BunTorrentError } from './utils/errors';
