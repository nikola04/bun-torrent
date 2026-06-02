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

/**
 * Setup phases reported through {@link DownloadOptions.onChangeState} before download starts.
 *
 * The values are emitted in order: `parsing` → `tracking` → `connecting` → `downloading`.
 * Once `downloading` fires, progress events take over via {@link Torrent.on}.
 */
export enum DownloadState {
    PARSING = 'parsing',
    TRACKING = 'tracking',
    CONNECTING = 'connecting',
    DOWNLOADING = 'downloading',
}

/**
 * Minimal DHT contract used by {@link Client} for peer discovery.
 *
 * Implement this to swap the default in-memory DHT for a persistent or
 * shared implementation. `close` is called from {@link Client.close}.
 */
export type ClientDht = {
    lookupPeers(infoHash: Uint8Array): Promise<PeerInfo[]>;
    close?(): void;
};

/**
 * Default options applied to every download started by a {@link Client}.
 *
 * All fields are optional. Any field can be overridden per-download via
 * {@link DownloadOptions}.
 */
export type ClientConfig = {
    /** Custom DHT implementation, or `false` to disable DHT entirely. Defaults to an in-memory {@link DhtClient}. */
    dht?: ClientDht | false;
    /** Default file selection for multi-file torrents. `null`/omitted downloads every file. */
    files?: TorrentFileSelection;
    /** Maximum block requests in flight per peer. Higher values increase throughput but also memory. Defaults to 300. */
    maxInFlightRequestsPerPeer?: number;
    /** Maximum simultaneous peer connection attempts. Defaults to 30. */
    maxConnecting?: number;
    /** Minimum connected peers required before download starts. `0` allows downloads to start with no peers. Defaults to 0. */
    minConnections?: number;
    /** Directory where downloaded files are written. Defaults to `process.cwd()`. */
    outputDirectory?: string;
    /** Timeout for a single peer TCP connect + handshake, in milliseconds. Defaults to 5000. */
    peerConnectTimeoutMs?: number;
    /** Granularity of `progress` events: `'piece'` (once per validated piece) or `'block'` (every received block). Defaults to `'piece'`. */
    progressEvents?: DownloadProgressEventMode;
    /** Timeout for a single block request, in milliseconds. Timed-out requests are retried on other peers. Defaults to 15000. */
    requestTimeoutMs?: number;
    /** Reserved for future seeding support. Currently only `false` is supported. */
    seed?: false;
    /** Minimum interval between speed recalculations, in milliseconds. Defaults to 500. */
    speedSampleIntervalMs?: number;
    /** Preferred number of connected peers. The pool stops opening new connections once this is reached. Defaults to 20. */
    targetConnections?: number;
    /** Timeout for tracker announce requests, in milliseconds. Defaults to 5000. */
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

/**
 * Entry point of the library. Holds shared state (peer id, DHT node) across downloads.
 *
 * One `Client` instance can run multiple concurrent downloads. The same client is also
 * reused across `inspect` → `download` flows so the DHT routing table and peer cache
 * can warm up once and pay off on subsequent calls.
 *
 * Call {@link Client.close} when the client is no longer needed — it closes every
 * active torrent and the DHT socket. After close, every method throws {@link ClientError}.
 *
 * @example
 * const client = new Client({ outputDirectory: './downloads' });
 * try {
 *     const torrent = await client.download({ torrentFile: './example.torrent' });
 *     await torrent.done;
 * } finally {
 *     client.close();
 * }
 */
export class Client {
    private readonly peerId: Uint8Array;
    private readonly dhtNodeId: Uint8Array;
    private readonly dht?: ClientDht;
    private readonly torrents = new Set<Torrent>();
    private closed = false;

    /**
     * Build a client with optional defaults that apply to every download.
     *
     * The constructor is cheap: it generates a peer id and a DHT node id but does not
     * open any sockets. The default DHT instance opens its UDP socket lazily on the
     * first lookup.
     *
     * @param config - Defaults applied to downloads started by this client.
     */
    constructor(private readonly config: ClientConfig = {}) {
        this.peerId = createPeerId();
        this.dhtNodeId = createDhtNodeId();
        this.dht =
            config.dht === false
                ? undefined
                : (config.dht ?? new DhtClient({ nodeId: this.dhtNodeId }));
    }

    /**
     * Start downloading a torrent and return a {@link Torrent} that emits progress events.
     *
     * The returned promise settles once the client has parsed metadata, discovered peers,
     * opened the peer pool, and started the download manager. The actual download runs
     * in the background — `await torrent.done` or listen for the `done` event to wait
     * for it to finish.
     *
     * Tracker failures are non-fatal: if no tracker returns peers, DHT lookup is attempted
     * when DHT is enabled. With DHT disabled, the download continues with whatever peers
     * were found provided `minConnections` is `0`.
     *
     * @param input - Torrent source: a `.torrent` file path/bytes, a magnet URI, or already-parsed `meta`.
     * @param options - Per-download overrides for {@link ClientConfig}, plus `announcePort` and `onChangeState`.
     * @returns A {@link Torrent} whose `done` promise settles when the download finishes or fails.
     * @throws {ClientError} When the client is closed, the input is unsupported, or file selection is invalid.
     */
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

    /**
     * Parse a `.torrent` file or magnet URI and return its metadata without starting a download.
     *
     * Useful for showing the file list, computing total size, or letting the user pick
     * a subset of files before calling {@link Client.download}. For magnet links this
     * method fetches the info dictionary from a peer using the `ut_metadata` extension,
     * so it may discover and warm DHT state that a later `download({ meta })` call reuses.
     *
     * @param input - Either `{ torrentFile }` (path/bytes/ArrayBuffer) or `{ magnet }` (URI string).
     * @param options - Optional overrides. `timeout` caps the per-peer metadata fetch for magnets.
     * @returns Parsed torrent metadata, including computed info hash.
     * @throws {ClientError} When the client is closed or no input is provided.
     * @throws {TorrentParseError} When the torrent file or magnet info dictionary cannot be parsed.
     * @throws {MagnetParseError} When the magnet URI is invalid or no peer returned metadata.
     */
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

    /**
     * Stop the client, close every active torrent, and release the DHT socket.
     *
     * Idempotent — calling close more than once is a no-op. After close, every other
     * method throws {@link ClientError} with code `CLIENT_CLOSED`.
     */
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

/**
 * Per-download overrides passed to {@link Client.download}.
 *
 * Every field except `announcePort` and `onChangeState` overrides the matching field
 * in {@link ClientConfig} for this download only.
 */
export type DownloadOptions = {
    /** Port sent to trackers in announce requests. Defaults to 6881. */
    announcePort?: number;
    /** Restrict the download to specific files. Selectable by `'a/b.txt'` string or `['a','b.txt']` array. */
    files?: TorrentFileSelection;
    /** Override {@link ClientConfig.maxInFlightRequestsPerPeer} for this download. */
    maxInFlightRequestsPerPeer?: number;
    /** Override {@link ClientConfig.maxConnecting} for this download. */
    maxConnecting?: number;
    /** Override {@link ClientConfig.minConnections} for this download. */
    minConnections?: number;
    /** Called with each setup phase before download starts. See {@link DownloadState}. */
    onChangeState?: (state: DownloadState) => unknown;
    /** Override {@link ClientConfig.outputDirectory} for this download. */
    outputDirectory?: string;
    /** Override {@link ClientConfig.peerConnectTimeoutMs} for this download. */
    peerConnectTimeoutMs?: number;
    /** Override {@link ClientConfig.progressEvents} for this download. */
    progressEvents?: DownloadProgressEventMode;
    /** Override {@link ClientConfig.requestTimeoutMs} for this download. */
    requestTimeoutMs?: number;
    /** Reserved for future seeding support. Currently only `false` is supported. */
    seed?: false;
    /** Override {@link ClientConfig.speedSampleIntervalMs} for this download. */
    speedSampleIntervalMs?: number;
    /** Override {@link ClientConfig.targetConnections} for this download. */
    targetConnections?: number;
    /** Override {@link ClientConfig.trackerTimeoutMs} for this download. */
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

/** Supported torrent file sources. */
export type TorrentFileInput = string | Uint8Array | ArrayBuffer;

/**
 * @internal
 */
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
