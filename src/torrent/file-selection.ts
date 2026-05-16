import type { TorrentMetadata } from './types';

export type TorrentFileSelection = readonly (string | readonly string[])[] | null;

export const getTorrentFilePathKey = (path: readonly string[]): string => path.join('/');

export const normalizeTorrentFileSelection = (
    files: TorrentFileSelection | undefined,
): Set<string> | undefined => {
    if (files === undefined || files === null) return undefined;

    return new Set(
        files.map((file) => (typeof file === 'string' ? file : getTorrentFilePathKey(file))),
    );
};

export const getSelectedPieceIndexes = (
    metadata: TorrentMetadata,
    files: TorrentFileSelection | undefined,
): number[] | undefined => {
    const selectedFiles = normalizeTorrentFileSelection(files);
    if (!selectedFiles) return undefined;

    const selectedPieces = new Set<number>();

    for (const file of metadata.files) {
        if (!selectedFiles.has(getTorrentFilePathKey(file.path))) continue;

        const fileStart = file.offset;
        const fileEnd = file.offset + file.length;
        const firstPiece = Math.floor(fileStart / metadata.pieceLength);
        const lastPiece = Math.floor(Math.max(fileStart, fileEnd - 1) / metadata.pieceLength);

        for (let pieceIndex = firstPiece; pieceIndex <= lastPiece; pieceIndex += 1) {
            selectedPieces.add(pieceIndex);
        }
    }

    return [...selectedPieces].sort((a, b) => a - b);
};

export const getUnknownSelectedFiles = (
    metadata: TorrentMetadata,
    files: TorrentFileSelection | undefined,
): string[] => {
    const selectedFiles = normalizeTorrentFileSelection(files);
    if (!selectedFiles) return [];

    const availableFiles = new Set(metadata.files.map((file) => getTorrentFilePathKey(file.path)));
    return [...selectedFiles].filter((file) => !availableFiles.has(file));
};
