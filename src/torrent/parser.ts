import { decodeBencode } from './bencode';
import { fail, readText, readInteger, readBytes } from './helpers';
import { computeInfoHash } from './info-hash';
import { TorrentParseErrorCode } from './parser.error';
import type { BDict, BValue } from './bencode/types';
import type { TorrentMetadata } from './types';

const textDecoder = new TextDecoder('utf-8', { fatal: true });

export const parseTorrent = (input: Uint8Array): TorrentMetadata => {
    const decoded = decodeBencode(input);
    if (!(decoded instanceof Map)) {
        return fail(
            TorrentParseErrorCode.ROOT_NOT_DICT,
            'Torrent root must be a dictionary',
            'root',
        );
    }

    const root = decoded;
    const infoValue = root.get('info');
    if (infoValue === undefined) {
        return fail(TorrentParseErrorCode.INFO_MISSING, 'Missing torrent info dictionary', 'info');
    }
    if (!(infoValue instanceof Map)) {
        return fail(
            TorrentParseErrorCode.INFO_NOT_DICT,
            'Torrent info must be a dictionary',
            'info',
        );
    }

    const info = infoValue;

    if (info.has('files')) {
        return fail(
            TorrentParseErrorCode.MULTI_FILE_UNSUPPORTED,
            'Multi-file torrents are not supported yet',
            'files',
        );
    }

    const name = readText(info, 'name');
    const pieceLength = readInteger(info, 'piece length');
    const piecesBytes = readBytes(info, 'pieces');
    const length = readInteger(info, 'length');

    return {
        announce: root.has('announce') ? readText(root, 'announce') : undefined,
        announceList: readAnnounceList(root),
        infoHash: computeInfoHash(info),
        name,
        pieceLength,
        pieces: splitPieces(piecesBytes),
        length,
    };
};

const readAnnounceList = (root: BDict): string[][] => {
    const value = root.get('announce-list');
    if (value === undefined) return [];

    if (!Array.isArray(value)) {
        return fail(
            TorrentParseErrorCode.FIELD_INVALID,
            'Expected announce-list to be a list',
            'announce-list',
        );
    }

    return value.map((tier, tierIndex) => readAnnounceTier(tier, tierIndex));
};

const readAnnounceTier = (value: BValue, tierIndex: number): string[] => {
    if (!Array.isArray(value)) {
        return fail(
            TorrentParseErrorCode.FIELD_INVALID,
            'Expected announce-list tier to be a list',
            `announce-list[${tierIndex}]`,
        );
    }

    return value.map((tracker, trackerIndex) => {
        if (!(tracker instanceof Uint8Array)) {
            return fail(
                TorrentParseErrorCode.FIELD_INVALID,
                'Expected announce-list tracker to be bytes',
                `announce-list[${tierIndex}][${trackerIndex}]`,
            );
        }

        return textDecoder.decode(tracker);
    });
};

const SHA1_HASH_LENGTH = 20;

const splitPieces = (pieces: Uint8Array): Uint8Array[] => {
    if (pieces.byteLength === 0 || pieces.byteLength % SHA1_HASH_LENGTH !== 0) {
        fail(TorrentParseErrorCode.PIECES_INVALID, 'Invalid pieces field', 'pieces');
    }

    const hashes: Uint8Array[] = [];

    for (let offset = 0; offset < pieces.byteLength; offset += SHA1_HASH_LENGTH) {
        hashes.push(pieces.subarray(offset, offset + SHA1_HASH_LENGTH));
    }

    return hashes;
};
