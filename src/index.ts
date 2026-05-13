/**
 * Copyright (c) 2026 Nikola Nedeljkovic
 * SPDX-License-Identifier: MIT
 */

export * from './client';

export {
    BencodeDecodeError,
    BencodeDecodeErrorCode,
    BencodeEncodeError,
    BencodeEncodeErrorCode,
    computeInfoHash,
    decodeBencode,
    encodeBencode,
    parseTorrent,
    toBValue,
    TorrentParseError,
    TorrentParseErrorCode,
    type TorrentMetadata,
} from '@torrent/index';
export {
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
    type PeerHandshake,
} from '@peer/index';
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
} from '@peer/index';

export { BunTorrentError } from '@utils/errors';
export type { BBytes, BDict, BInteger, BList, BValue, BencodeInput } from '@torrent/index';
