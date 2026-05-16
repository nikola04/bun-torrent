import type { TorrentFileSelection } from '../file-selection';

export type FileWrite = {
    path: string[];
    fileOffset: number;
    dataOffset: number;
    length: number;
};

export type WritePieceOptions = {
    files?: TorrentFileSelection;
    outputDirectory: string;
};
