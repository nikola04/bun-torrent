/**
 * Copyright (c) 2026 Nikola Nedeljkovic
 * SPDX-License-Identifier: MIT
 */

export * from './client';
export { ClientError, ClientErrorCode } from './client.error';

export {
    BencodeDecodeError,
    BencodeDecodeErrorCode,
    BencodeEncodeError,
    BencodeEncodeErrorCode,
    computeInfoHash,
    decodeBencode,
    encodeBencode,
    parseTorrent,
    Torrent,
    TorrentState,
    toBValue,
    TorrentParseError,
    TorrentParseErrorCode,
    type TorrentFileSelection,
    type TorrentMetadata,
} from './torrent/index';
export {
    connectToPeers,
    createPeerId,
    decodeHandshake,
    decodePeerMessage,
    encodePeerMessage,
    encodeHandshake,
    HandshakeErrorCode,
    PeerMessageError,
    PeerMessageErrorCode,
    PeerMessageId,
    PeerHandshakeError,
    PeerPoolError,
    PeerPoolErrorCode,
    PeerPool,
    PeerSession,
    PeerSessionError,
    PeerSessionErrorCode,
    openPeerPool,
    type PeerHandshake,
} from './peer/index';
export { TrackerError, TrackerErrorCode } from './tracker';
export type {
    BitfieldMessage,
    CancelMessage,
    ChokeMessage,
    HaveMessage,
    InterestedMessage,
    KeepAliveMessage,
    NotInterestedMessage,
    PeerMessage,
    PieceMessage,
    RequestMessage,
    UnchokeMessage,
    PeerConnectionSession,
    PeerPoolOptions,
    PeerSessionConnectOptions,
} from './peer/index';

export { BunTorrentError } from './utils/errors';
export type {
    BBytes,
    BDict,
    BInteger,
    BList,
    BValue,
    BencodeInput,
    TorrentFiles,
    TorrentStats,
    TorrentStateChange,
} from './torrent/index';
