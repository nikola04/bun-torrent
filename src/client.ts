import { createPeerId } from '@peer/peer-id';
import { openPeerPool } from '@peer/pool';
import { parseTorrent } from '@torrent/parser';
import type { TorrentMetadata } from '@torrent/types';
import { trackPeers } from './tracker';

export class Client {
    private readonly peerId: Uint8Array;

    constructor() {
        this.peerId = createPeerId();
    }

    public async download(input: {
        torrentFile: string | Uint8Array | ArrayBuffer;
    }): Promise<void> {
        const bytes = await readTorrentFile(input.torrentFile);
        const meta = parseTorrent(bytes);

        const peers = await trackPeers({ meta, peerId: this.peerId });

        const pool = await openPeerPool(peers, {
            infoHash: meta.infoHash,
            peerId: this.peerId,
            targetConnections: 20,
            minConnections: 1,
            maxConnecting: 30,
            timeoutMs: 3_000,
        });

        console.log('Handshake OK:', pool.size);

        pool.onSession(() => {
            console.log('Pool size:', pool.size);
        });

        const sessions = await pool.done;
        console.log('Pool done:', sessions.length);
        pool.close();
    }

    public async inspect(input: {
        torrentFile: string | Uint8Array | ArrayBuffer;
    }): Promise<TorrentMetadata> {
        const bytes = await readTorrentFile(input.torrentFile);
        return parseTorrent(bytes);
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
