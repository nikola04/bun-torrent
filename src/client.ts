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

export enum DownloadState {
    PARSING = 'parsing',
    TRACKING = 'tracking',
    CONNECTING = 'connecting',
    DOWNLOADING = 'downloading',
}

export type ClientConfig = {
    files?: TorrentFileSelection;
    maxInFlightRequestsPerPeer?: number;
    outputDirectory?: string;
    progressEvents?: DownloadProgressEventMode;
    requestTimeoutMs?: number;
    speedSampleIntervalMs?: number;
};

export const DEFAULT_CLIENT_CONFIG = {
    maxInFlightRequestsPerPeer: 20,
    progressEvents: 'piece',
    requestTimeoutMs: 15_000,
    speedSampleIntervalMs: 500,
} as const satisfies Required<
    Pick<
        ClientConfig,
        | 'maxInFlightRequestsPerPeer'
        | 'progressEvents'
        | 'requestTimeoutMs'
        | 'speedSampleIntervalMs'
    >
>;

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
        const peers = await this.trackPeers(meta, options);

        options.onChangeState?.(DownloadState.CONNECTING);
        const pool = await openPeerPool(peers, {
            infoHash: meta.infoHash,
            peerId: this.peerId,
            targetConnections: 20,
            totalPieces: meta.pieces.length,
            minConnections: options.minConnections ?? 0,
            maxConnecting: 30,
            timeoutMs: 5_000,
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
        );
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
    files?: TorrentFileSelection;
    maxInFlightRequestsPerPeer?: number;
    minConnections?: number;
    onChangeState?: (state: DownloadState) => unknown;
    outputDirectory?: string;
    progressEvents?: DownloadProgressEventMode;
    requestTimeoutMs?: number;
    speedSampleIntervalMs?: number;
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
        DEFAULT_CLIENT_CONFIG.maxInFlightRequestsPerPeer,
    outputDirectory: options.outputDirectory ?? config.outputDirectory ?? process.cwd(),
    progressEvents:
        options.progressEvents ?? config.progressEvents ?? DEFAULT_CLIENT_CONFIG.progressEvents,
    requestTimeoutMs:
        options.requestTimeoutMs ??
        config.requestTimeoutMs ??
        DEFAULT_CLIENT_CONFIG.requestTimeoutMs,
    speedSampleIntervalMs:
        options.speedSampleIntervalMs ??
        config.speedSampleIntervalMs ??
        DEFAULT_CLIENT_CONFIG.speedSampleIntervalMs,
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
