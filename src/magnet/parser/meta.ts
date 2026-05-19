import type { TorrentMetadata } from '../../torrent';
import type { TorrentFile } from '../../torrent/types';

const textDecoder = new TextDecoder();

export const parseInfoDict = (
    dict: unknown,
    infoHash: Uint8Array,
    announce?: string,
    announceList: string[][] = [],
): TorrentMetadata => {
    if (!(dict instanceof Map)) throw new Error('Info dict must be a Map');

    const name = dict.get('name');
    if (!(name instanceof Uint8Array)) throw new Error('Missing name');

    const pieceLength = dict.get('piece length');
    if (typeof pieceLength !== 'number') throw new Error('Missing piece length');

    const piecesRaw = dict.get('pieces');
    if (!(piecesRaw instanceof Uint8Array) || piecesRaw.byteLength % 20 !== 0)
        throw new Error('Invalid pieces');

    const pieces: Uint8Array[] = [];
    for (let i = 0; i < piecesRaw.byteLength; i += 20) {
        pieces.push(piecesRaw.subarray(i, i + 20));
    }

    const filesRaw = dict.get('files');
    if (Array.isArray(filesRaw)) {
        let offset = 0;
        const files: TorrentFile[] = filesRaw.map((f) => {
            if (!(f instanceof Map)) throw new Error('Invalid file entry');

            const length = f.get('length');
            if (typeof length !== 'number') throw new Error('Missing file length');

            const path = f.get('path');
            if (!Array.isArray(path)) throw new Error('Missing file path');

            const file: TorrentFile = {
                path: path.map((p) => {
                    if (!(p instanceof Uint8Array)) throw new Error('Invalid path segment');
                    return textDecoder.decode(p);
                }),
                length,
                offset,
            };
            offset += length;
            return file;
        });

        return {
            announce,
            announceList,
            infoHash,
            name: textDecoder.decode(name),
            pieceLength,
            pieces,
            length: offset,
            files,
        };
    }

    // single-file
    const length = dict.get('length');
    if (typeof length !== 'number') throw new Error('Missing length');

    return {
        announce,
        announceList,
        infoHash,
        name: textDecoder.decode(name),
        pieceLength,
        pieces,
        length,
        files: [{ path: [textDecoder.decode(name)], length, offset: 0 }],
    };
};
