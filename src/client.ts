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

export enum DownloadState {
    PARSING = 'parsing',
    TRACKING = 'tracking',
    CONNECTING = 'connecting',
    DOWNLOADING = 'downloading',
}

export type ClientConfig = {
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

export class Client {
    private readonly peerId: Uint8Array;

    constructor(private readonly config: ClientConfig = {}) {
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
        const downloadConfig = resolveDownloadConfig(this.config, options);
        assertValidFileSelection(meta, downloadConfig.files);

        options.onChangeState?.(DownloadState.TRACKING);
        const peers = await this.trackPeers(meta, options, downloadConfig);

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
        return new Torrent(
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
    }

    public async inspect(input: {
        torrentFile: string | Uint8Array | ArrayBuffer;
    }): Promise<TorrentMetadata> {
        const bytes = await readTorrentFile(input.torrentFile);
        return parseTorrent(bytes);
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

type ResolvedDownloadConfig = Required<ClientConfig>;

type PeerInfo = Awaited<ReturnType<typeof trackPeers>>[number];

const isNonFatalTrackerError = (error: unknown): error is TrackerError =>
    error instanceof TrackerError &&
    (error.code === TrackerErrorCode.ANNOUNCE_FAILED ||
        error.code === TrackerErrorCode.NO_PEERS ||
        error.code === TrackerErrorCode.NO_SUPPORTED_TRACKERS);

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
