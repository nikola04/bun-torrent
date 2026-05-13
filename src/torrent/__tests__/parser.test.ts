import { describe, expect, test } from 'bun:test';

import { BunTorrentError } from '@utils/errors';
import { bytesToHex } from '@utils/buffers';
import { encodeBencode, toBValue } from '../bencode';
import { TorrentParseError, TorrentParseErrorCode } from '../parser.error';
import { parseTorrent } from '../parser';

const textEncoder = new TextEncoder();

const bytes = (value: string): Uint8Array => textEncoder.encode(value);

const makePieces = (count: number): Uint8Array => {
    const pieces = new Uint8Array(count * 20);

    for (let i = 0; i < pieces.byteLength; i++) {
        pieces[i] = i;
    }

    return pieces;
};

const makeTorrent = ({
    info: infoOverrides = {},
    root: rootOverrides = {},
}: {
    info?: Record<string, unknown>;
    root?: Record<string, unknown>;
} = {}): Uint8Array => {
    const info = Object.fromEntries(
        Object.entries({
            length: 12345,
            name: 'file.bin',
            'piece length': 16384,
            pieces: makePieces(2),
            ...infoOverrides,
        }).filter(([, value]) => value !== undefined),
    );

    return encodeBencode(
        toBValue(
            Object.fromEntries(
                Object.entries({
                    announce: 'https://tracker.test/announce',
                    info,
                    ...rootOverrides,
                }).filter(([, value]) => value !== undefined),
            ),
        ),
    );
};

const expectParseError = (input: Uint8Array, code: TorrentParseErrorCode, field?: string): void => {
    try {
        parseTorrent(input);
        throw new Error('Expected parseTorrent to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(TorrentParseError);
        expect(error).toBeInstanceOf(BunTorrentError);
        expect((error as TorrentParseError).code).toBe(code);

        if (field !== undefined) {
            expect((error as TorrentParseError).field).toBe(field);
        }
    }
};

describe('parseTorrent', () => {
    test('parses single-file torrent metadata', () => {
        const metadata = parseTorrent(makeTorrent());

        expect(metadata.announce).toBe('https://tracker.test/announce');
        expect(metadata.announceList).toEqual([]);
        expect(metadata.name).toBe('file.bin');
        expect(metadata.length).toBe(12345);
        expect(metadata.pieceLength).toBe(16384);
        expect(metadata.pieces).toHaveLength(2);
        expect([...metadata.pieces[0]!]).toEqual([...makePieces(1)]);
        expect([...metadata.pieces[1]!]).toEqual([...makePieces(2).subarray(20, 40)]);
        expect(metadata.files).toEqual([{ path: ['file.bin'], length: 12345, offset: 0 }]);
        expect(metadata.infoHash.byteLength).toBe(20);
        expect(bytesToHex(metadata.infoHash)).toBe('a6de37ba09e404285c68421a31e3320ae9758501');
    });

    test('parses multi-file torrent metadata', () => {
        const metadata = parseTorrent(
            makeTorrent({
                info: {
                    name: 'folder',
                    length: undefined,
                    files: [
                        {
                            length: 100,
                            path: ['a.txt'],
                        },
                        {
                            length: 250,
                            path: ['nested', 'b.bin'],
                        },
                    ],
                },
            }),
        );

        expect(metadata.name).toBe('folder');
        expect(metadata.length).toBe(350);
        expect(metadata.files).toEqual([
            { path: ['a.txt'], length: 100, offset: 0 },
            { path: ['nested', 'b.bin'], length: 250, offset: 100 },
        ]);
    });

    test('parses announce-list tiers', () => {
        const metadata = parseTorrent(
            makeTorrent({
                root: {
                    'announce-list': [
                        ['https://tracker-a.test/announce'],
                        ['https://tracker-b.test/announce', 'https://tracker-c.test/announce'],
                    ],
                },
            }),
        );

        expect(metadata.announceList).toEqual([
            ['https://tracker-a.test/announce'],
            ['https://tracker-b.test/announce', 'https://tracker-c.test/announce'],
        ]);
    });

    test('allows torrents without announce', () => {
        const input = encodeBencode(
            toBValue({
                info: {
                    length: 12345,
                    name: 'file.bin',
                    'piece length': 16384,
                    pieces: makePieces(1),
                },
            }),
        );

        expect(parseTorrent(input).announce).toBeUndefined();
    });

    test('rejects non-dictionary roots', () => {
        expectParseError(encodeBencode(1), TorrentParseErrorCode.ROOT_NOT_DICT, 'root');
    });

    test('rejects missing info dictionary', () => {
        expectParseError(
            encodeBencode(toBValue({ announce: 'https://tracker.test/announce' })),
            TorrentParseErrorCode.INFO_MISSING,
            'info',
        );
    });

    test('rejects non-dictionary info values', () => {
        expectParseError(
            encodeBencode(toBValue({ info: 'file.bin' })),
            TorrentParseErrorCode.INFO_NOT_DICT,
            'info',
        );
    });

    test('rejects missing required info fields', () => {
        expectParseError(
            makeTorrent({ info: { name: undefined } }),
            TorrentParseErrorCode.FIELD_MISSING,
            'name',
        );
    });

    test('rejects invalid required info field types', () => {
        expectParseError(
            makeTorrent({ info: { length: bytes('12345') } }),
            TorrentParseErrorCode.FIELD_INVALID,
            'length',
        );
    });

    test('rejects pieces values that are not made of 20-byte SHA-1 hashes', () => {
        expectParseError(
            makeTorrent({ info: { pieces: new Uint8Array(21) } }),
            TorrentParseErrorCode.PIECES_INVALID,
            'pieces',
        );
        expectParseError(
            makeTorrent({ info: { pieces: new Uint8Array() } }),
            TorrentParseErrorCode.PIECES_INVALID,
            'pieces',
        );
    });

    test('rejects invalid multi-file entries', () => {
        expectParseError(
            makeTorrent({
                info: {
                    length: undefined,
                    files: ['file.bin'],
                },
            }),
            TorrentParseErrorCode.FIELD_INVALID,
            'files[0]',
        );

        expectParseError(
            makeTorrent({
                info: {
                    length: undefined,
                    files: [
                        {
                            path: ['file.bin'],
                        },
                    ],
                },
            }),
            TorrentParseErrorCode.FIELD_MISSING,
            'files[0].length',
        );

        expectParseError(
            makeTorrent({
                info: {
                    length: undefined,
                    files: [
                        {
                            length: 123,
                            path: [],
                        },
                    ],
                },
            }),
            TorrentParseErrorCode.FILE_PATH_INVALID,
            'files[0].path',
        );

        expectParseError(
            makeTorrent({
                info: {
                    length: undefined,
                    files: [
                        {
                            length: 123,
                            path: ['..'],
                        },
                    ],
                },
            }),
            TorrentParseErrorCode.FILE_PATH_INVALID,
            'files[0].path[0]',
        );
    });

    test('rejects invalid announce-list shape', () => {
        expectParseError(
            makeTorrent({
                root: {
                    'announce-list': 'https://tracker.test/announce',
                },
            }),
            TorrentParseErrorCode.FIELD_INVALID,
            'announce-list',
        );

        expectParseError(
            makeTorrent({
                root: {
                    'announce-list': ['https://tracker.test/announce'],
                },
            }),
            TorrentParseErrorCode.FIELD_INVALID,
            'announce-list[0]',
        );

        expectParseError(
            makeTorrent({
                root: {
                    'announce-list': [[123]],
                },
            }),
            TorrentParseErrorCode.FIELD_INVALID,
            'announce-list[0][0]',
        );
    });
});
