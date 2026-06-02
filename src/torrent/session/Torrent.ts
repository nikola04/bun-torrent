import type { DownloadProgress, DownloadProgressListener } from '../download';
import type { TorrentFile, TorrentMetadata } from '../types';

/**
 * Snapshot of peer-pool activity for a torrent.
 *
 * Emitted as the payload of the `peer` event whenever the pool gains a new session.
 */
export type TorrentStats = {
    /** Total peers known to the pool (from trackers and DHT). */
    peers: number;
    /** Peers currently connected and past handshake. */
    connections: number;
    /** Peers whose TCP connection or handshake is still in progress. */
    connecting: number;
    /** Total connection attempts started since pool creation. */
    connectionAttempts: number;
    /** Connection attempts that ended in error or timeout. */
    failedConnections: number;
    /** Preferred upper bound on `connections` (from {@link ClientConfig.targetConnections}). */
    targetConnections: number;
};

/**
 * Lifecycle states of a {@link Torrent}.
 *
 * Transitions: `downloading` → (`completed` | `failed` | `closed`). Terminal states
 * never transition further.
 */
export enum TorrentState {
    DOWNLOADING = 'downloading',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CLOSED = 'closed',
}

/** Payload of the `state` event. */
export type TorrentStateChange = {
    /** State the torrent left. */
    previous: TorrentState;
    /** State the torrent entered. */
    state: TorrentState;
};

export type TorrentEventMap = {
    close: [];
    done: [];
    error: [error: unknown];
    peer: [stats: TorrentStats];
    progress: [progress: DownloadProgress];
    state: [change: TorrentStateChange];
};

export type TorrentEventName = keyof TorrentEventMap;

export type TorrentEventListener<TEvent extends TorrentEventName> = (
    ...args: TorrentEventMap[TEvent]
) => void;

/** File selection breakdown returned by {@link Torrent.files}. */
export type TorrentFiles = {
    /** Files that will be written to disk for this download. */
    included: TorrentFile[];
    /** Files present in the torrent but skipped via the `files` option. */
    excluded: TorrentFile[];
};

type TorrentPeerPool = {
    readonly done: Promise<unknown>;
    readonly totalPeers: number;
    readonly size: number;
    readonly connecting: number;
    readonly attempted: number;
    readonly failed: number;
    readonly targetConnections: number;
    onSession(callback: (session: unknown) => void): () => void;
    close(): void;
};

type TorrentDownloadManager = {
    readonly done: Promise<void>;
    readonly progress: DownloadProgress;
    onProgress(listener: DownloadProgressListener): () => void;
    start(): void;
    close(): void;
};

/**
 * A single in-progress (or completed) download.
 *
 * Returned by {@link Client.download}. Exposes the current state, progress, and stats
 * as readable properties, and emits events through {@link Torrent.on}. The `done`
 * promise resolves when the download completes successfully and rejects on failure.
 *
 * Peer sessions are closed automatically when the download completes (seeding is not
 * implemented). Call {@link Torrent.close} to stop an active download early.
 *
 * @example
 * const torrent = await client.download({ torrentFile: './example.torrent' });
 * torrent.on('progress', (p) => console.log(`${(p.percent * 100).toFixed(1)}% @ ${p.speed}`));
 * torrent.on('done', () => console.log('done'));
 * torrent.on('error', (err) => console.error(err));
 * await torrent.done;
 */
export class Torrent {
    /**
     * Resolves when the download completes successfully, rejects when it fails.
     *
     * For both outcomes the torrent emits a corresponding event (`done` / `error`)
     * before this promise settles.
     */
    public readonly done: Promise<void>;
    private readonly listeners = new Map<TorrentEventName, Set<(...args: unknown[]) => void>>();
    private currentState = TorrentState.DOWNLOADING;
    private lastError: unknown;
    private resourcesClosed = false;

    public constructor(
        public readonly metadata: TorrentMetadata,
        private readonly peerPool: TorrentPeerPool,
        private readonly downloadManager?: TorrentDownloadManager,
        private readonly selectedFiles?: Set<string> | null,
        private readonly seed: false = false,
    ) {
        this.downloadManager?.onProgress((progress) => this.emit('progress', progress));
        this.downloadManager?.start();
        this.done = downloadManager?.done ?? peerPool.done.then(() => undefined);
        void this.done.then(
            () => {
                if (this.currentState === TorrentState.CLOSED) return;

                this.setState(TorrentState.COMPLETED);
                this.emit('done');
                if (!this.seed) this.closeResources();
            },
            (error) => {
                if (this.currentState === TorrentState.CLOSED) return;

                this.lastError = error;
                this.setState(TorrentState.FAILED);
                this.emit('error', error);
                this.closeResources();
            },
        );
    }

    /** Current lifecycle state. See {@link TorrentState}. */
    public get state(): TorrentState {
        return this.currentState;
    }

    /** Last error observed during the download, or `undefined` if none. Always set when state is `failed`. */
    public get error(): unknown {
        return this.lastError;
    }

    /** Live peer-pool stats. See {@link TorrentStats}. */
    public get stats(): TorrentStats {
        return {
            peers: this.peerPool.totalPeers,
            connections: this.peerPool.size,
            connecting: this.peerPool.connecting,
            connectionAttempts: this.peerPool.attempted,
            failedConnections: this.peerPool.failed,
            targetConnections: this.peerPool.targetConnections,
        };
    }

    /**
     * Live download progress snapshot.
     *
     * `receivedBytes` counts bytes that have arrived from peers; `downloadedBytes`
     * counts only bytes from pieces that have passed SHA-1 validation and been written
     * to disk. The two differ during active download because in-flight pieces have
     * received blocks but no hash has been verified yet.
     */
    public get progress(): DownloadProgress {
        return (
            this.downloadManager?.progress ?? {
                totalBytes: this.metadata.length,
                receivedBytes: 0,
                downloadedBytes: 0,
                totalPieces: this.metadata.pieces.length,
                completedPieces: 0,
                percent: this.metadata.length === 0 ? 1 : 0,
                speedBytesPerSecond: 0,
                speed: '0.0 Bps',
            }
        );
    }

    /**
     * File selection for this download, partitioned into included and excluded sets.
     *
     * When no `files` option was supplied, every torrent file is included.
     */
    public get files(): TorrentFiles {
        if (!this.selectedFiles) return { included: this.metadata.files, excluded: [] };

        const included = this.metadata.files.filter((f) =>
            this.selectedFiles?.has(f.path.join('/')),
        );
        const excluded = this.metadata.files.filter(
            (f) => !this.selectedFiles?.has(f.path.join('/')),
        );
        return { included, excluded };
    }

    /**
     * Subscribe to a torrent event. Returns an unsubscribe function.
     *
     * Events:
     * - `state` — every state transition, with `{ previous, state }`.
     * - `progress` — emitted on piece completion or every block, depending on `progressEvents`.
     * - `peer` — a new peer session joined the pool. Receives current {@link TorrentStats}.
     * - `done` — the download completed successfully. Fires once.
     * - `error` — the download failed. Receives the error. Fires once.
     * - `close` — {@link Torrent.close} was called. Fires once.
     *
     * @param event - Event name.
     * @param listener - Callback invoked with the event payload.
     * @returns Unsubscribe function. Idempotent and safe to call after the torrent closes.
     */
    public on<TEvent extends TorrentEventName>(
        event: TEvent,
        listener: TorrentEventListener<TEvent>,
    ): () => void {
        if (event === 'peer') {
            return this.peerPool.onSession(() => {
                (listener as TorrentEventListener<'peer'>)(this.stats);
            });
        }

        const listeners = this.getListeners(event);
        listeners.add(listener as (...args: unknown[]) => void);

        return () => {
            listeners.delete(listener as (...args: unknown[]) => void);
        };
    }

    /**
     * Stop the download, close peer sessions, and transition to {@link TorrentState.CLOSED}.
     *
     * Idempotent. After close, the `done` promise will not resolve or reject again,
     * and `progress` / `stats` snapshot the values at close time.
     */
    public close(): void {
        if (this.currentState === TorrentState.CLOSED) return;

        this.closeResources();
        this.setState(TorrentState.CLOSED);
        this.emit('close');
    }

    private closeResources(): void {
        if (this.resourcesClosed) return;

        this.resourcesClosed = true;
        this.downloadManager?.close();
        this.peerPool.close();
    }

    private setState(state: TorrentState): void {
        if (this.currentState === state) return;

        const previous = this.currentState;
        this.currentState = state;
        this.emit('state', { previous, state });
    }

    private emit<TEvent extends TorrentEventName>(
        event: TEvent,
        ...args: TorrentEventMap[TEvent]
    ): void {
        for (const listener of this.getListeners(event)) {
            listener(...args);
        }
    }

    private getListeners(event: TorrentEventName): Set<(...args: unknown[]) => void> {
        const existing = this.listeners.get(event);
        if (existing) return existing;

        const listeners = new Set<(...args: unknown[]) => void>();
        this.listeners.set(event, listeners);
        return listeners;
    }
}
