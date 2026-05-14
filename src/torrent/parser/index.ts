import { decodeBencode } from '../bencode';
import { fail, readText, readInteger, readBytes } from './helpers';
import { computeInfoHash } from './info-hash';
import { TorrentParseErrorCode } from './parser.error';
import type { BDict, BValue } from '../bencode/types';
import type { TorrentFile, TorrentMetadata } from '../types';

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

    const name = readText(info, 'name');
    const pieceLength = readInteger(info, 'piece length');
    const piecesBytes = readBytes(info, 'pieces');
    const files = readFiles(info, name);
    const length = files.reduce((total, file) => total + file.length, 0);

    return {
        announce: root.has('announce') ? readText(root, 'announce') : undefined,
        announceList: readAnnounceList(root),
        infoHash: computeInfoHash(info),
        name,
        pieceLength,
        pieces: splitPieces(piecesBytes),
        length,
        files,
    };
};

const readFiles = (info: BDict, name: string): TorrentFile[] => {
    const filesValue = info.get('files');
    if (filesValue === undefined) {
        const length = readInteger(info, 'length');
        return [{ path: [name], length, offset: 0 }];
    }

    if (!Array.isArray(filesValue)) {
        return fail(TorrentParseErrorCode.FIELD_INVALID, 'Expected files to be a list', 'files');
    }

    const files: TorrentFile[] = [];
    let offset = 0;

    for (let index = 0; index < filesValue.length; index++) {
        const fileValue = filesValue[index]!;
        if (!(fileValue instanceof Map)) {
            return fail(
                TorrentParseErrorCode.FIELD_INVALID,
                'Expected file entry to be a dictionary',
                `files[${index}]`,
            );
        }

        const length = readFileLength(fileValue, index);
        const path = readFilePath(fileValue, index);

        files.push({ path, length, offset });
        offset += length;
    }

    return files;
};

const readFileLength = (file: BDict, fileIndex: number): number => {
    const value = file.get('length');
    if (value === undefined) {
        return fail(
            TorrentParseErrorCode.FIELD_MISSING,
            `Missing field: files[${fileIndex}].length`,
            `files[${fileIndex}].length`,
        );
    }
    if (typeof value !== 'number') {
        return fail(
            TorrentParseErrorCode.FIELD_INVALID,
            `Expected integer: files[${fileIndex}].length`,
            `files[${fileIndex}].length`,
        );
    }

    return value;
};

const readFilePath = (file: BDict, fileIndex: number): string[] => {
    const value = file.get('path');
    if (value === undefined) {
        return fail(
            TorrentParseErrorCode.FIELD_MISSING,
            `Missing field: files[${fileIndex}].path`,
            `files[${fileIndex}].path`,
        );
    }
    if (!Array.isArray(value) || value.length === 0) {
        return fail(
            TorrentParseErrorCode.FILE_PATH_INVALID,
            'Expected file path to be a non-empty list',
            `files[${fileIndex}].path`,
        );
    }

    return value.map((segment, segmentIndex) => {
        if (!(segment instanceof Uint8Array)) {
            return fail(
                TorrentParseErrorCode.FILE_PATH_INVALID,
                'Expected file path segment to be bytes',
                `files[${fileIndex}].path[${segmentIndex}]`,
            );
        }

        const text = textDecoder.decode(segment);
        if (text.length === 0 || text === '.' || text === '..' || text.includes('/')) {
            return fail(
                TorrentParseErrorCode.FILE_PATH_INVALID,
                'Invalid file path segment',
                `files[${fileIndex}].path[${segmentIndex}]`,
            );
        }

        return text;
    });
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
