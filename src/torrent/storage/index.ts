import type { TorrentMetadata } from '@torrent/types';
import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
    getPieceLength,
    validatePiece,
    type PieceCompletion,
    type PieceValidationResult,
} from '../pieces';
import { getTorrentFilePathKey, normalizeTorrentFileSelection } from '../file-selection';
import { TorrentStorageError, TorrentStorageErrorCode } from './storage.error';
import type { FileWrite, WritePieceOptions } from './types';

/**
 * Map a completed piece to file write ranges in torrent file order.
 *
 * @param metadata - Parsed torrent metadata.
 * @param pieceIndex - Completed piece index.
 * @param data - Completed piece bytes.
 * @returns File write ranges that cover the piece data.
 * @throws {TorrentStorageError} When the piece index or piece length is invalid.
 */
export const planPieceWrites = (
    metadata: TorrentMetadata,
    pieceIndex: number,
    data: Uint8Array,
): FileWrite[] => {
    const pieceLength = getStoragePieceLength(metadata, pieceIndex);
    if (data.byteLength !== pieceLength) {
        throw new TorrentStorageError(
            TorrentStorageErrorCode.INVALID_PIECE_LENGTH,
            `Piece ${pieceIndex} length mismatch: expected ${pieceLength}, received ${data.byteLength}`,
            pieceIndex,
        );
    }

    const pieceStart = pieceIndex * metadata.pieceLength;
    const pieceEnd = pieceStart + data.byteLength;
    const writes: FileWrite[] = [];

    for (const file of metadata.files) {
        const fileStart = file.offset;
        const fileEnd = file.offset + file.length;
        const start = Math.max(pieceStart, fileStart);
        const end = Math.min(pieceEnd, fileEnd);

        if (start >= end) continue;

        writes.push({
            path: file.path,
            fileOffset: start - fileStart,
            dataOffset: start - pieceStart,
            length: end - start,
        });
    }

    const plannedLength = writes.reduce((total, write) => total + write.length, 0);
    if (plannedLength !== data.byteLength) {
        throw new TorrentStorageError(
            TorrentStorageErrorCode.INVALID_FILE_LAYOUT,
            `Torrent file layout does not cover piece ${pieceIndex}`,
            pieceIndex,
        );
    }

    return writes;
};

/**
 * Write a validated completed piece into its torrent files.
 *
 * @param metadata - Parsed torrent metadata.
 * @param pieceIndex - Completed piece index.
 * @param data - Validated piece bytes.
 * @param options - Storage options including output directory.
 * @throws {TorrentStorageError} When the piece or target file path is invalid.
 */
export const writePiece = async (
    metadata: TorrentMetadata,
    pieceIndex: number,
    data: Uint8Array,
    options: WritePieceOptions,
): Promise<void> => {
    const selectedFiles = normalizeTorrentFileSelection(options.files);
    const writes = planPieceWrites(metadata, pieceIndex, data).filter(
        (write) => !selectedFiles || selectedFiles.has(getTorrentFilePathKey(write.path)),
    );

    for (const write of writes) {
        const path = resolveTorrentFilePath(options.outputDirectory, write.path);
        await mkdir(dirname(path), { recursive: true });

        const file = await openWritableFile(path);
        try {
            await file.write(
                data.subarray(write.dataOffset, write.dataOffset + write.length),
                0,
                write.length,
                write.fileOffset,
            );
        } finally {
            await file.close();
        }
    }
};

/**
 * Validate a completed piece and write it only when its SHA-1 hash matches.
 *
 * @param metadata - Parsed torrent metadata.
 * @param piece - Completed piece returned by the planner.
 * @param options - Storage options including output directory.
 * @returns Piece validation result. Invalid pieces are not written to disk.
 * @throws {TorrentStorageError} When storage planning or file writing fails for a valid piece.
 */
export const writeValidatedPiece = async (
    metadata: TorrentMetadata,
    piece: PieceCompletion,
    options: WritePieceOptions,
): Promise<PieceValidationResult> => {
    const validation = validatePiece(piece);
    if (!validation.valid) return validation;

    await writePiece(metadata, piece.pieceIndex, piece.data, options);
    return validation;
};

const getStoragePieceLength = (metadata: TorrentMetadata, pieceIndex: number): number => {
    try {
        return getPieceLength(metadata, pieceIndex);
    } catch {
        throw new TorrentStorageError(
            TorrentStorageErrorCode.INVALID_PIECE_INDEX,
            `Unknown piece index: ${pieceIndex}`,
            pieceIndex,
        );
    }
};

const resolveTorrentFilePath = (outputDirectory: string, parts: string[]): string => {
    if (
        parts.some(
            (part) =>
                part === '' ||
                part === '.' ||
                part === '..' ||
                part.includes('/') ||
                part.includes('\\'),
        )
    ) {
        throw new TorrentStorageError(
            TorrentStorageErrorCode.INVALID_FILE_PATH,
            `Invalid torrent file path: ${parts.join('/')}`,
        );
    }

    return join(outputDirectory, ...parts);
};

const openWritableFile = async (path: string): Promise<FileHandle> => {
    try {
        return await open(path, constants.O_RDWR);
    } catch (error) {
        if (!isNotFoundError(error)) throw error;
        return await open(path, constants.O_RDWR | constants.O_CREAT);
    }
};

const isNotFoundError = (error: unknown): error is NodeJS.ErrnoException =>
    error instanceof Error && 'code' in error && error.code === 'ENOENT';

export { TorrentStorageError, TorrentStorageErrorCode } from './storage.error';
export type { FileWrite, WritePieceOptions } from './types';
