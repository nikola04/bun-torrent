export type TorrentFile = {
    path: string[];
    length: number;
    offset: number;
};

export type TorrentMetadata = {
    announce?: string;
    announceList: string[][];
    infoHash: Uint8Array;
    name: string;
    pieceLength: number;
    pieces: Uint8Array[];
    length: number;
    files: TorrentFile[];
};
