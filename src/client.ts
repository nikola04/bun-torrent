import { parseTorrent } from '@torrent/parser';
import type { TorrentMetadata } from '@torrent/types';

export type InspectTorrentInput = {
    torrentFile: TorrentFileInput;
};

export class Client {
    constructor() {}

    public async inspect(input: InspectTorrentInput): Promise<TorrentMetadata> {
        const bytes = await readTorrentFile(input.torrentFile);
        return parseTorrent(bytes);
    }

    download(_input: unknown): unknown {
        throw new Error('Download is not implemented yet');
    }
}

export type TorrentFileInput = string | Uint8Array | ArrayBuffer;

export const readTorrentFile = async (input: TorrentFileInput): Promise<Uint8Array> => {
    if (typeof input === 'string') return await Bun.file(input).bytes();
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);

    throw new TypeError('Unsupported torrent file input');
};

export { Client as TorrentClient };
