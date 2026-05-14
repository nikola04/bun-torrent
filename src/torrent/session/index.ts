import type { TorrentMetadata } from '../types';

export type TorrentStats = {
    peers: number;
    connections: number;
    connecting: number;
    connectionAttempts: number;
    failedConnections: number;
    targetConnections: number;
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

export class Torrent {
    public readonly done: Promise<void>;

    public constructor(
        public readonly metadata: TorrentMetadata,
        private readonly peerPool: TorrentPeerPool,
    ) {
        this.done = peerPool.done.then(() => undefined);
        void this.done.catch(() => undefined);
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

    public onPeer(callback: () => void): () => void {
        return this.peerPool.onSession(() => callback());
    }

    public close(): void {
        this.peerPool.close();
    }
}
