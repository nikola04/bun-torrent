import { createPeerId } from './peer/peer-id';
import { openPeerPool } from './peer/pool';
import { DownloadManager, type DownloadProgressEventMode } from './torrent/download';
import { parseTorrent } from './torrent/parser';
import { Torrent } from './torrent/session/index';
import type { TorrentMetadata } from './torrent/types';
import { ClientError, ClientErrorCode } from './client.error';
import { trackPeers, TrackerError, TrackerErrorCode } from './tracker';
import type { TorrentFileSelection } from './torrent/file-selection';
import { getUnknownSelectedFiles, normalizeTorrentFileSelection } from './torrent/file-selection';
import { defaults } from './configs/defaults';
import { BunTorrentError } from './utils/errors';
import { parseMagnet } from './magnet';
import { DhtClient } from './dht';
import { createDhtNodeId } from './dht/utils/distance';
import type { PeerInfo } from './tracker/types';

export enum DownloadState {
    PARSING = 'parsing',
    TRACKING = 'tracking',
    CONNECTING = 'connecting',
    DOWNLOADING = 'downloading',
}

export type ClientDht = {
    lookupPeers(infoHash: Uint8Array): Promise<PeerInfo[]>;
    close?(): void;
};

export type ClientConfig = {
    dht?: ClientDht | false;
    files?: TorrentFileSelection;
    maxInFlightRequestsPerPeer?: number;
    maxConnecting?: number;
    minConnections?: number;
    outputDirectory?: string;
    peerConnectTimeoutMs?: number;
    progressEvents?: DownloadProgressEventMode;
    requestTimeoutMs?: number;
    seed?: false;
    speedSampleIntervalMs?: number;
    targetConnections?: number;
    trackerTimeoutMs?: number;
};

type InspectInput =
    | {
          torrentFile: string | Uint8Array | ArrayBuffer;
          magnet?: undefined | null;
          meta?: null;
      }
    | {
          magnet: string;
          torrentFile?: undefined | null;
          meta?: null;
      };

type DownloadInput = { meta: TorrentMetadata } | InspectInput;

export class Client {
    private readonly peerId: Uint8Array;
    private readonly dhtNodeId: Uint8Array;
    private readonly dht?: ClientDht;
    private readonly torrents = new Set<Torrent>();
    private closed = false;

    constructor(private readonly config: ClientConfig = {}) {
        this.peerId = createPeerId();
        this.dhtNodeId = createDhtNodeId();
        this.dht =
            config.dht === false
                ? undefined
                : (config.dht ?? new DhtClient({ nodeId: this.dhtNodeId }));
    }

    public async download(input: DownloadInput, options: DownloadOptions = {}): Promise<Torrent> {
        this.assertOpen();
        options.onChangeState?.(DownloadState.PARSING);
        const meta =
            input.meta ?? (await this.inspect(input, { timeout: options.trackerTimeoutMs }));
        const downloadConfig = resolveDownloadConfig(this.config, options);
        assertValidFileSelection(meta, downloadConfig.files);

        options.onChangeState?.(DownloadState.TRACKING);
        const peers = await this.discoverPeers(meta, options, downloadConfig);

        options.onChangeState?.(DownloadState.CONNECTING);
        const pool = await openPeerPool(peers, {
            infoHash: meta.infoHash,
            peerId: this.peerId,
            targetConnections: downloadConfig.targetConnections,
            totalPieces: meta.pieces.length,
            minConnections: downloadConfig.minConnections,
            maxConnecting: downloadConfig.maxConnecting,
            timeoutMs: downloadConfig.peerConnectTimeoutMs,
        });

        options.onChangeState?.(DownloadState.DOWNLOADING);
        const torrent = new Torrent(
            meta,
            pool,
            new DownloadManager({
                metadata: meta,
                files: downloadConfig.files,
                outputDirectory: downloadConfig.outputDirectory,
                peerPool: pool,
                maxInFlightRequestsPerPeer: downloadConfig.maxInFlightRequestsPerPeer,
                progressEvents: downloadConfig.progressEvents,
                requestTimeoutMs: downloadConfig.requestTimeoutMs,
                speedSampleIntervalMs: downloadConfig.speedSampleIntervalMs,
            }),
            normalizeTorrentFileSelection(downloadConfig.files),
            downloadConfig.seed,
        );

        this.trackTorrent(torrent);
        return torrent;
    }

    public async inspect(
        input: InspectInput,
        options?: { timeout?: number },
    ): Promise<TorrentMetadata> {
        this.assertOpen();
        if ('torrentFile' in input && input.torrentFile !== undefined) {
            const bytes = await readTorrentFile(input.torrentFile);
            return parseTorrent(bytes);
        }
        if ('magnet' in input && input.magnet !== undefined && input.magnet !== null) {
            return parseMagnet(input.magnet, this.peerId, { ...options, dht: this.dht });
        }
        throw new BunTorrentError('No input provided', 'NO_INPUT');
    }

    public close(): void {
        if (this.closed) return;

        this.closed = true;
        for (const torrent of this.torrents) torrent.close();
        this.torrents.clear();
        this.dht?.close?.();
    }

    private async discoverPeers(
        meta: TorrentMetadata,
        options: DownloadOptions,
        config: ResolvedDownloadConfig,
    ): Promise<PeerInfo[]> {
        const peers = new Map<string, PeerInfo>();

        for (const peer of await this.trackPeers(meta, options, config)) {
            peers.set(peerKey(peer), peer);
        }

        if (peers.size > 0 || !this.dht) return [...peers.values()];

        try {
            for (const peer of await this.dht.lookupPeers(meta.infoHash)) {
                peers.set(peerKey(peer), peer);
            }
        } catch {
            return [...peers.values()];
        }

        return [...peers.values()];
    }

    private async trackPeers(
        meta: TorrentMetadata,
        options: DownloadOptions,
        config: ResolvedDownloadConfig,
    ): Promise<PeerInfo[]> {
        try {
            return await trackPeers({
                meta,
                peerId: this.peerId,
                announcePort: options.announcePort,
                timeoutMs: config.trackerTimeoutMs,
            });
        } catch (error) {
            if (isNonFatalTrackerError(error)) return [];
            throw error;
        }
    }

    private trackTorrent(torrent: Torrent): void {
        this.torrents.add(torrent);
        torrent.on('close', () => this.torrents.delete(torrent));
        void torrent.done.then(
            () => this.torrents.delete(torrent),
            () => this.torrents.delete(torrent),
        );
    }

    private assertOpen(): void {
        if (!this.closed) return;

        throw new ClientError(ClientErrorCode.CLOSED, 'Torrent client is closed');
    }
}

export type DownloadOptions = {
    announcePort?: number;
    files?: TorrentFileSelection;
    maxInFlightRequestsPerPeer?: number;
    maxConnecting?: number;
    minConnections?: number;
    onChangeState?: (state: DownloadState) => unknown;
    outputDirectory?: string;
    peerConnectTimeoutMs?: number;
    progressEvents?: DownloadProgressEventMode;
    requestTimeoutMs?: number;
    seed?: false;
    speedSampleIntervalMs?: number;
    targetConnections?: number;
    trackerTimeoutMs?: number;
};

type ResolvedDownloadConfig = Required<Omit<ClientConfig, 'dht'>>;

const isNonFatalTrackerError = (error: unknown): error is TrackerError =>
    error instanceof TrackerError &&
    (error.code === TrackerErrorCode.ANNOUNCE_FAILED ||
        error.code === TrackerErrorCode.NO_PEERS ||
        error.code === TrackerErrorCode.NO_SUPPORTED_TRACKERS);

const peerKey = (peer: PeerInfo): string => `${peer.ip}:${peer.port}`;

const resolveDownloadConfig = (
    config: ClientConfig,
    options: DownloadOptions,
): ResolvedDownloadConfig => ({
    files: options.files ?? config.files ?? null,
    maxInFlightRequestsPerPeer:
        options.maxInFlightRequestsPerPeer ??
        config.maxInFlightRequestsPerPeer ??
        defaults.download.maxInFlightRequestsPerPeer,
    maxConnecting: options.maxConnecting ?? config.maxConnecting ?? defaults.peers.maxConnecting,
    minConnections:
        options.minConnections ?? config.minConnections ?? defaults.peers.minConnections,
    outputDirectory: options.outputDirectory ?? config.outputDirectory ?? process.cwd(),
    peerConnectTimeoutMs:
        options.peerConnectTimeoutMs ??
        config.peerConnectTimeoutMs ??
        defaults.peers.connectTimeoutMs,
    progressEvents: options.progressEvents ?? config.progressEvents ?? defaults.progress.events,
    requestTimeoutMs:
        options.requestTimeoutMs ?? config.requestTimeoutMs ?? defaults.download.requestTimeoutMs,
    seed: options.seed ?? config.seed ?? defaults.download.seed,
    speedSampleIntervalMs:
        options.speedSampleIntervalMs ??
        config.speedSampleIntervalMs ??
        defaults.progress.speedSampleIntervalMs,
    targetConnections:
        options.targetConnections ?? config.targetConnections ?? defaults.peers.targetConnections,
    trackerTimeoutMs:
        options.trackerTimeoutMs ?? config.trackerTimeoutMs ?? defaults.trackers.timeoutMs,
});

const assertValidFileSelection = (
    metadata: TorrentMetadata,
    files: TorrentFileSelection | undefined,
): void => {
    const unknownFiles = getUnknownSelectedFiles(metadata, files);
    if (unknownFiles.length === 0) return;

    throw new ClientError(
        ClientErrorCode.INVALID_FILE_SELECTION,
        `Unknown torrent file selection: ${unknownFiles.join(', ')}`,
    );
};

export type TorrentFileInput = string | Uint8Array | ArrayBuffer;

export const readTorrentFile = async (input: unknown): Promise<Uint8Array> => {
    if (typeof input === 'string') return await Bun.file(input).bytes();
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);

    throw new ClientError(
        ClientErrorCode.UNSUPPORTED_TORRENT_FILE_INPUT,
        'Unsupported torrent file input',
    );
};

export { Client as TorrentClient };
