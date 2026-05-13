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
    encodeHandshake,
    HandshakeErrorCode,
    PeerHandshakeError,
    type PeerHandshake,
} from '@peer/index';

export { BunTorrentError } from '@utils/errors';
export type { BBytes, BDict, BInteger, BList, BValue, BencodeInput } from '@torrent/index';
