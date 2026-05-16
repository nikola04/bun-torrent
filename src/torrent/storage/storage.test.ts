import { describe, expect, test } from 'bun:test';

import type { TorrentMetadata } from '@torrent/types';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha1 } from '@utils/sha1';
import {
    planPieceWrites,
    TorrentStorageError,
    TorrentStorageErrorCode,
    writePiece,
    writeValidatedPiece,
} from './index';

const makeMetadata = ({
    length,
    pieceLength,
    files,
}: Pick<TorrentMetadata, 'length' | 'pieceLength' | 'files'>): TorrentMetadata => ({
    announceList: [],
    infoHash: new Uint8Array(20),
    name: 'download',
    pieceLength,
    pieces: Array.from({ length: Math.ceil(length / pieceLength) }, () => new Uint8Array(20)),
    length,
    files,
});

const readBytes = async (path: string): Promise<number[]> => [...(await Bun.file(path).bytes())];

describe('planPieceWrites', () => {
    test('maps a single-file piece to one write', () => {
        const metadata = makeMetadata({
            length: 10,
            pieceLength: 4,
            files: [{ path: ['file.bin'], length: 10, offset: 0 }],
        });

        expect(planPieceWrites(metadata, 1, new Uint8Array([4, 5, 6, 7]))).toEqual([
            { path: ['file.bin'], fileOffset: 4, dataOffset: 0, length: 4 },
        ]);
    });

    test('splits a piece across multiple files', () => {
        const metadata = makeMetadata({
            length: 10,
            pieceLength: 4,
            files: [
                { path: ['a.bin'], length: 6, offset: 0 },
                { path: ['nested', 'b.bin'], length: 4, offset: 6 },
            ],
        });

        expect(planPieceWrites(metadata, 1, new Uint8Array([4, 5, 6, 7]))).toEqual([
            { path: ['a.bin'], fileOffset: 4, dataOffset: 0, length: 2 },
            { path: ['nested', 'b.bin'], fileOffset: 0, dataOffset: 2, length: 2 },
        ]);
    });

    test('maps the final shorter piece', () => {
        const metadata = makeMetadata({
            length: 10,
            pieceLength: 4,
            files: [{ path: ['file.bin'], length: 10, offset: 0 }],
        });

        expect(planPieceWrites(metadata, 2, new Uint8Array([8, 9]))).toEqual([
            { path: ['file.bin'], fileOffset: 8, dataOffset: 0, length: 2 },
        ]);
    });

    test('splits one piece across three files', () => {
        const metadata = makeMetadata({
            length: 12,
            pieceLength: 6,
            files: [
                { path: ['a.bin'], length: 3, offset: 0 },
                { path: ['b.bin'], length: 5, offset: 3 },
                { path: ['c.bin'], length: 4, offset: 8 },
            ],
        });

        expect(planPieceWrites(metadata, 1, new Uint8Array([6, 7, 8, 9, 10, 11]))).toEqual([
            { path: ['b.bin'], fileOffset: 3, dataOffset: 0, length: 2 },
            { path: ['c.bin'], fileOffset: 0, dataOffset: 2, length: 4 },
        ]);
    });

    test('rejects invalid piece indexes and lengths', () => {
        const metadata = makeMetadata({
            length: 10,
            pieceLength: 4,
            files: [{ path: ['file.bin'], length: 10, offset: 0 }],
        });

        expect(() => planPieceWrites(metadata, 3, new Uint8Array())).toThrow(TorrentStorageError);
        expect(() => planPieceWrites(metadata, 3, new Uint8Array())).toThrow(
            'Unknown piece index: 3',
        );

        try {
            planPieceWrites(metadata, 3, new Uint8Array());
            throw new Error('Expected planPieceWrites to throw');
        } catch (error) {
            expect((error as TorrentStorageError).code).toBe(
                TorrentStorageErrorCode.INVALID_PIECE_INDEX,
            );
        }

        try {
            planPieceWrites(metadata, 2, new Uint8Array([8]));
            throw new Error('Expected planPieceWrites to throw');
        } catch (error) {
            expect((error as TorrentStorageError).code).toBe(
                TorrentStorageErrorCode.INVALID_PIECE_LENGTH,
            );
        }
    });

    test('rejects file layouts that do not cover the whole piece', () => {
        const metadata = makeMetadata({
            length: 8,
            pieceLength: 4,
            files: [
                { path: ['a.bin'], length: 2, offset: 0 },
                { path: ['b.bin'], length: 2, offset: 6 },
            ],
        });

        expect(() => planPieceWrites(metadata, 0, new Uint8Array([1, 2, 3, 4]))).toThrow(
            TorrentStorageError,
        );

        try {
            planPieceWrites(metadata, 0, new Uint8Array([1, 2, 3, 4]));
            throw new Error('Expected planPieceWrites to throw');
        } catch (error) {
            expect((error as TorrentStorageError).code).toBe(
                TorrentStorageErrorCode.INVALID_FILE_LAYOUT,
            );
        }
    });

    test('rejects overlapping file layouts for a piece', () => {
        const metadata = makeMetadata({
            length: 6,
            pieceLength: 4,
            files: [
                { path: ['a.bin'], length: 4, offset: 0 },
                { path: ['b.bin'], length: 4, offset: 2 },
            ],
        });

        expect(() => planPieceWrites(metadata, 0, new Uint8Array([1, 2, 3, 4]))).toThrow(
            TorrentStorageError,
        );

        try {
            planPieceWrites(metadata, 0, new Uint8Array([1, 2, 3, 4]));
            throw new Error('Expected planPieceWrites to throw');
        } catch (error) {
            expect((error as TorrentStorageError).code).toBe(
                TorrentStorageErrorCode.INVALID_FILE_LAYOUT,
            );
        }
    });
});

describe('writePiece', () => {
    test('writes a piece to a single file at the correct offset', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'bun-torrent-storage-'));
        const metadata = makeMetadata({
            length: 8,
            pieceLength: 4,
            files: [{ path: ['file.bin'], length: 8, offset: 0 }],
        });

        await writePiece(metadata, 0, new Uint8Array([1, 2, 3, 4]), { outputDirectory });
        await writePiece(metadata, 1, new Uint8Array([5, 6, 7, 8]), { outputDirectory });

        expect(await readBytes(join(outputDirectory, 'file.bin'))).toEqual([
            1, 2, 3, 4, 5, 6, 7, 8,
        ]);
    });

    test('writes a piece across multiple files', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'bun-torrent-storage-'));
        const metadata = makeMetadata({
            length: 10,
            pieceLength: 4,
            files: [
                { path: ['a.bin'], length: 6, offset: 0 },
                { path: ['nested', 'b.bin'], length: 4, offset: 6 },
            ],
        });

        await writePiece(metadata, 1, new Uint8Array([4, 5, 6, 7]), { outputDirectory });

        expect(await readBytes(join(outputDirectory, 'a.bin'))).toEqual([0, 0, 0, 0, 4, 5]);
        expect(await readBytes(join(outputDirectory, 'nested', 'b.bin'))).toEqual([6, 7]);
    });

    test('creates nested directories before writing', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'bun-torrent-storage-'));
        const metadata = makeMetadata({
            length: 4,
            pieceLength: 4,
            files: [{ path: ['deep', 'nested', 'file.bin'], length: 4, offset: 0 }],
        });

        await writePiece(metadata, 0, new Uint8Array([1, 2, 3, 4]), { outputDirectory });

        expect(await readBytes(join(outputDirectory, 'deep', 'nested', 'file.bin'))).toEqual([
            1, 2, 3, 4,
        ]);
    });

    test('overwrites the same piece bytes at the same offset', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'bun-torrent-storage-'));
        const metadata = makeMetadata({
            length: 8,
            pieceLength: 4,
            files: [{ path: ['file.bin'], length: 8, offset: 0 }],
        });
        await writeFile(
            join(outputDirectory, 'file.bin'),
            new Uint8Array([0, 0, 0, 0, 9, 9, 9, 9]),
        );

        await writePiece(metadata, 1, new Uint8Array([5, 6, 7, 8]), { outputDirectory });
        await writePiece(metadata, 1, new Uint8Array([8, 7, 6, 5]), { outputDirectory });

        expect(await readBytes(join(outputDirectory, 'file.bin'))).toEqual([
            0, 0, 0, 0, 8, 7, 6, 5,
        ]);
    });

    test('rejects unsafe torrent file paths', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'bun-torrent-storage-'));
        const unsafePaths = [
            ['..', 'evil.bin'],
            ['.', 'evil.bin'],
            ['', 'evil.bin'],
            ['nested/evil.bin'],
            ['nested\\evil.bin'],
        ];

        for (const path of unsafePaths) {
            const metadata = makeMetadata({
                length: 4,
                pieceLength: 4,
                files: [{ path, length: 4, offset: 0 }],
            });

            await expect(
                writePiece(metadata, 0, new Uint8Array([1, 2, 3, 4]), { outputDirectory }),
            ).rejects.toMatchObject({
                code: TorrentStorageErrorCode.INVALID_FILE_PATH,
            });
        }
    });
});

describe('writeValidatedPiece', () => {
    test('writes a completed piece when its hash matches', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'bun-torrent-storage-'));
        const data = new Uint8Array([1, 2, 3, 4]);
        const metadata = makeMetadata({
            length: 4,
            pieceLength: 4,
            files: [{ path: ['file.bin'], length: 4, offset: 0 }],
        });

        const result = await writeValidatedPiece(
            metadata,
            { pieceIndex: 0, data, expectedHash: sha1(data) },
            { outputDirectory },
        );

        expect(result.valid).toBe(true);
        expect(await readBytes(join(outputDirectory, 'file.bin'))).toEqual([1, 2, 3, 4]);
    });

    test('does not write a completed piece when its hash does not match', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'bun-torrent-storage-'));
        const metadata = makeMetadata({
            length: 4,
            pieceLength: 4,
            files: [{ path: ['file.bin'], length: 4, offset: 0 }],
        });

        const result = await writeValidatedPiece(
            metadata,
            {
                pieceIndex: 0,
                data: new Uint8Array([1, 2, 3, 4]),
                expectedHash: sha1(new Uint8Array([4, 3, 2, 1])),
            },
            { outputDirectory },
        );

        expect(result.valid).toBe(false);
        expect(await Bun.file(join(outputDirectory, 'file.bin')).exists()).toBe(false);
    });
});
