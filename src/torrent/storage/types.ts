export type FileWrite = {
    path: string[];
    fileOffset: number;
    dataOffset: number;
    length: number;
};

export type WritePieceOptions = {
    outputDirectory: string;
};
