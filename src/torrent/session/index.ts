import type { DownloadProgress, DownloadProgressListener } from '../download';
import type { TorrentFile, TorrentMetadata } from '../types';

export type TorrentStats = {
    peers: number;
    connections: number;
    connecting: number;
    connectionAttempts: number;
    failedConnections: number;
    targetConnections: number;
};

export type TorrentEventMap = {
    close: [];
    done: [];
    error: [error: unknown];
    peer: [session: unknown];
    progress: [progress: DownloadProgress];
};

export type TorrentEventName = keyof TorrentEventMap;

export type TorrentEventListener<TEvent extends TorrentEventName> = (
    ...args: TorrentEventMap[TEvent]
) => void;

export type TorrentFiles = {
    included: TorrentFile[];
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

export class Torrent {
    public readonly done: Promise<void>;
    private readonly listeners = new Map<TorrentEventName, Set<(...args: unknown[]) => void>>();

    public constructor(
        public readonly metadata: TorrentMetadata,
        private readonly peerPool: TorrentPeerPool,
        private readonly downloadManager?: TorrentDownloadManager,
        private readonly selectedFiles?: Set<string> | null,
    ) {
        this.downloadManager?.onProgress((progress) => this.emit('progress', progress));
        this.downloadManager?.start();
        this.done = downloadManager?.done ?? peerPool.done.then(() => undefined);
        void this.done.then(
            () => this.emit('done'),
            (error) => this.emit('error', error),
        );
    }

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

    public on<TEvent extends TorrentEventName>(
        event: TEvent,
        listener: TorrentEventListener<TEvent>,
    ): () => void {
        if (event === 'peer') {
            return this.peerPool.onSession((session) => {
                (listener as TorrentEventListener<'peer'>)(session);
            });
        }

        const listeners = this.getListeners(event);
        listeners.add(listener as (...args: unknown[]) => void);

        return () => {
            listeners.delete(listener as (...args: unknown[]) => void);
        };
    }

    public close(): void {
        this.downloadManager?.close();
        this.peerPool.close();
        this.emit('close');
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
