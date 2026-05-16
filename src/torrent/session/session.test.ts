import { describe, expect, test } from 'bun:test';

import { Torrent } from '.';
import type { DownloadProgress, DownloadProgressListener } from '../download';
import type { TorrentMetadata } from '../types';

describe('Torrent', () => {
    test('returns live stats from the peer pool', () => {
        const pool = new FakePeerPool();
        const torrent = new Torrent(makeMetadata(), pool);

        expect(torrent.stats).toEqual({
            peers: 10,
            connections: 1,
            connecting: 2,
            connectionAttempts: 3,
            failedConnections: 4,
            targetConnections: 5,
        });

        pool.size = 2;
        pool.connecting = 1;

        expect(torrent.stats.connections).toBe(2);
        expect(torrent.stats.connecting).toBe(1);
    });

    test('closes the peer pool', () => {
        const pool = new FakePeerPool();
        const torrent = new Torrent(makeMetadata(), pool);

        torrent.close();

        expect(pool.closed).toBe(true);
    });

    test('starts and closes the download manager when provided', async () => {
        const pool = new FakePeerPool();
        const manager = new FakeDownloadManager();
        const torrent = new Torrent(makeMetadata(), pool, manager);

        expect(manager.started).toBe(true);
        expect(torrent.done).toBe(manager.done);

        manager.resolve();
        await expect(torrent.done).resolves.toBeUndefined();

        torrent.close();

        expect(manager.closed).toBe(true);
        expect(pool.closed).toBe(true);
    });

    test('emits peer, done, and close events', async () => {
        const pool = new FakePeerPool();
        const manager = new FakeDownloadManager();
        const torrent = new Torrent(makeMetadata(), pool, manager);
        const peers: unknown[] = [];
        let done = false;
        let closed = false;

        torrent.on('peer', (session) => peers.push(session));
        torrent.on('done', () => {
            done = true;
        });
        torrent.on('close', () => {
            closed = true;
        });

        const peer = {};
        pool.addSession(peer);
        manager.resolve();
        await torrent.done;

        torrent.close();

        expect(peers).toEqual([peer]);
        expect(done).toBe(true);
        expect(closed).toBe(true);
    });

    test('emits errors when download fails', async () => {
        const pool = new FakePeerPool();
        const manager = new FakeDownloadManager();
        const torrent = new Torrent(makeMetadata(), pool, manager);
        const errors: unknown[] = [];

        torrent.on('error', (error) => errors.push(error));

        const error = new Error('download failed');
        manager.reject(error);
        await expect(torrent.done).rejects.toBe(error);

        expect(errors).toEqual([error]);
    });

    test('returns and emits download progress', () => {
        const pool = new FakePeerPool();
        const manager = new FakeDownloadManager();
        const torrent = new Torrent(makeMetadata(), pool, manager);
        const events: DownloadProgress[] = [];

        torrent.on('progress', (progress) => events.push(progress));

        manager.progress = {
            totalBytes: 16_384,
            receivedBytes: 8_192,
            downloadedBytes: 0,
            totalPieces: 1,
            completedPieces: 0,
            percent: 0,
        };
        manager.emitProgress();

        expect(torrent.progress).toEqual(manager.progress);
        expect(events).toEqual([manager.progress]);
    });
});

class FakePeerPool {
    public done = Promise.resolve([]);
    public totalPeers = 10;
    public size = 1;
    public connecting = 2;
    public attempted = 3;
    public failed = 4;
    public targetConnections = 5;
    public closed = false;
    private readonly sessions: unknown[] = [];
    private readonly sessionListeners = new Set<(session: unknown) => void>();

    public onSession(callback: (session: unknown) => void): () => void {
        this.sessionListeners.add(callback);
        for (const session of this.sessions) callback(session);

        return () => {
            this.sessionListeners.delete(callback);
        };
    }

    public close(): void {
        this.closed = true;
    }

    public addSession(session: unknown): void {
        this.sessions.push(session);
        for (const listener of this.sessionListeners) listener(session);
    }
}

class FakeDownloadManager {
    public started = false;
    public closed = false;
    public done: Promise<void>;
    public progress: DownloadProgress = {
        totalBytes: 16_384,
        receivedBytes: 0,
        downloadedBytes: 0,
        totalPieces: 1,
        completedPieces: 0,
        percent: 0,
    };
    private readonly progressListeners = new Set<DownloadProgressListener>();
    private resolveDone!: () => void;
    private rejectDone!: (error: unknown) => void;

    public constructor() {
        this.done = new Promise((resolve, reject) => {
            this.resolveDone = resolve;
            this.rejectDone = reject;
        });
    }

    public start(): void {
        this.started = true;
    }

    public close(): void {
        this.closed = true;
    }

    public onProgress(listener: DownloadProgressListener): () => void {
        this.progressListeners.add(listener);

        return () => {
            this.progressListeners.delete(listener);
        };
    }

    public emitProgress(): void {
        for (const listener of this.progressListeners) listener(this.progress);
    }

    public resolve(): void {
        this.resolveDone();
    }

    public reject(error: unknown): void {
        this.rejectDone(error);
    }
}

const makeMetadata = (): TorrentMetadata => ({
    announce: 'udp://tracker.test:80',
    announceList: [],
    infoHash: new Uint8Array(20),
    name: 'file.bin',
    pieceLength: 16_384,
    pieces: [new Uint8Array(20)],
    length: 16_384,
    files: [{ path: ['file.bin'], length: 16_384, offset: 0 }],
});
