import { createPeerId } from '@peer/peer-id';
import { openPeerPool } from '@peer/pool';
import { parseTorrent } from '@torrent/parser/';
import { Torrent } from '@torrent/session/index';
import type { TorrentMetadata } from '@torrent/types';
import { ClientError, ClientErrorCode } from './client.error';
import { trackPeers, TrackerError, TrackerErrorCode } from './tracker';

export enum DownloadState {
    PARSING = 'parsing',
    TRACKING = 'tracking',
    CONNECTING = 'connecting',
}

export class Client {
    private readonly peerId: Uint8Array;

    constructor() {
        this.peerId = createPeerId();
    }

    public async download(
        input: {
            torrentFile: string | Uint8Array | ArrayBuffer;
        },
        options: DownloadOptions = {},
    ): Promise<Torrent> {
        options.onChangeState?.(DownloadState.PARSING);
        const meta = await this.inspect(input);

        options.onChangeState?.(DownloadState.TRACKING);
        const peers = await this.trackPeers(meta, options);

        options.onChangeState?.(DownloadState.CONNECTING);
        const pool = await openPeerPool(peers, {
            infoHash: meta.infoHash,
            peerId: this.peerId,
            targetConnections: 20,
            minConnections: options.minConnections ?? 0,
            maxConnecting: 30,
            timeoutMs: 5_000,
        });

        return new Torrent(meta, pool);
    }

    public async inspect(input: {
        torrentFile: string | Uint8Array | ArrayBuffer;
    }): Promise<TorrentMetadata> {
        const bytes = await readTorrentFile(input.torrentFile);
        return parseTorrent(bytes);
    }

    private async trackPeers(meta: TorrentMetadata, options: DownloadOptions): Promise<PeerInfo[]> {
        try {
            return await trackPeers({
                meta,
                peerId: this.peerId,
                announcePort: options.announcePort,
                timeoutMs: 5_000,
            });
        } catch (error) {
            if (isNonFatalTrackerError(error)) return [];
            throw error;
        }
    }
}

export type DownloadOptions = {
    announcePort?: number;
    minConnections?: number;
    onChangeState?: (state: DownloadState) => unknown;
};

type PeerInfo = Awaited<ReturnType<typeof trackPeers>>[number];

const isNonFatalTrackerError = (error: unknown): error is TrackerError =>
    error instanceof TrackerError &&
    (error.code === TrackerErrorCode.ANNOUNCE_FAILED ||
        error.code === TrackerErrorCode.NO_PEERS ||
        error.code === TrackerErrorCode.NO_SUPPORTED_TRACKERS);

export type TorrentFileInput = string | Uint8Array | ArrayBuffer;

export const readTorrentFile = async (input: TorrentFileInput): Promise<Uint8Array> => {
    if (typeof input === 'string') return await Bun.file(input).bytes();
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);

    throw new ClientError(
        ClientErrorCode.UNSUPPORTED_TORRENT_FILE_INPUT,
        'Unsupported torrent file input',
    );
};

export { Client as TorrentClient };
