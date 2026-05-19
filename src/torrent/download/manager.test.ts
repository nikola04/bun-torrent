import { describe, expect, test } from 'bun:test';

import type { PeerMessage } from '../../peer/messages';
import type { PeerPool } from '../../peer/pool';
import type { PeerSession } from '../../peer/session';
import { createPiecePlanner, type PieceAvailability, type PieceCompletion } from '../pieces';
import type { TorrentMetadata } from '../types';
import { DownloadManager, type DownloadManagerOptions, type DownloadProgress } from './manager';

const makeMetadata = ({
    length = 4,
    pieceLength = 4,
    pieces = 1,
}: {
    length?: number;
    pieceLength?: number;
    pieces?: number;
} = {}): TorrentMetadata => ({
    announceList: [],
    infoHash: new Uint8Array(20),
    name: 'file.bin',
    pieceLength,
    pieces: Array.from({ length: pieces }, (_, index) => new Uint8Array(20).fill(index)),
    length,
    files: [{ path: ['file.bin'], length, offset: 0 }],
});

class FakeAvailability implements PieceAvailability {
    public constructor(private readonly pieces: Set<number>) {}

    public hasPiece(pieceIndex: number): boolean {
        return this.pieces.has(pieceIndex);
    }

    public toPieceIndexes(): number[] {
        return Array.from(this.pieces);
    }
}

class FakePeer {
    public sent: PeerMessage[] = [];
    public peerAvailability: PieceAvailability;
    private readonly throwOnRequest: boolean;

    private readonly messageListeners = new Set<(message: PeerMessage) => void>();
    private readonly closeListeners = new Set<() => void>();

    public constructor({
        choked = true,
        pieces = [0],
        throwOnRequest = false,
    }: {
        choked?: boolean;
        pieces?: number[];
        throwOnRequest?: boolean;
    } = {}) {
        this.choked = choked;
        this.peerAvailability = new FakeAvailability(new Set(pieces));
        this.throwOnRequest = throwOnRequest;
    }

    public choked: boolean;

    public onClose(callback: () => void): () => void {
        this.closeListeners.add(callback);
        return () => this.closeListeners.delete(callback);
    }

    public onMessage(callback: (message: PeerMessage) => void): () => void {
        this.messageListeners.add(callback);
        return () => this.messageListeners.delete(callback);
    }

    public sendMessage(message: PeerMessage): void {
        if (this.throwOnRequest && message.type === 'request') throw new Error('send failed');

        this.sent.push(message);
    }

    public emit(message: PeerMessage): void {
        if (message.type === 'choke') this.choked = true;
        if (message.type === 'unchoke') this.choked = false;

        for (const listener of this.messageListeners) listener(message);
    }

    public close(): void {
        for (const listener of this.closeListeners) listener();
    }
}

class FakePeerPool {
    private readonly peers: FakePeer[] = [];
    private readonly listeners = new Set<(peer: FakePeer) => void>();

    public onSession(callback: (session: FakePeer) => void): () => void {
        this.listeners.add(callback);
        for (const peer of this.peers) callback(peer);

        return () => {
            this.listeners.delete(callback);
        };
    }

    public add(peer: FakePeer): void {
        this.peers.push(peer);
        for (const listener of this.listeners) listener(peer);
    }
}

type WriteValidatedPiece = NonNullable<DownloadManagerOptions['writeValidatedPiece']>;

const makeWriteValidated = ({
    completions,
    valid = true,
}: {
    completions?: PieceCompletion[];
    valid?: boolean;
} = {}): WriteValidatedPiece => {
    return async (_metadata, piece) => {
        completions?.push(piece);

        return {
            pieceIndex: piece.pieceIndex,
            actualHash: new Uint8Array(20),
            expectedHash: piece.expectedHash,
            valid,
        };
    };
};

const nextTick = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
};

const requestMessages = (peer: FakePeer): Extract<PeerMessage, { type: 'request' }>[] =>
    peer.sent.filter((message): message is Extract<PeerMessage, { type: 'request' }> => {
        return message.type === 'request';
    });

const asPeerPool = (pool: FakePeerPool): PeerPool => pool as unknown as PeerPool;
const asPeer = (peer: FakePeer): PeerSession => peer as unknown as PeerSession;

describe('DownloadManager', () => {
    test('sends interested while choked when the peer has useful pieces', () => {
        const pool = new FakePeerPool();
        const manager = new DownloadManager({
            metadata: makeMetadata(),
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            writeValidatedPiece: makeWriteValidated(),
        });
        const peer = new FakePeer({ choked: true });

        manager.start();
        pool.add(peer);

        expect(peer.sent).toEqual([{ type: 'interested' }]);
    });

    test('requests blocks from an unchoked peer and respects the in-flight limit', () => {
        const pool = new FakePeerPool();
        const manager = new DownloadManager({
            metadata: makeMetadata({ length: 8, pieceLength: 4, pieces: 2 }),
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            maxInFlightRequestsPerPeer: 2,
            writeValidatedPiece: makeWriteValidated(),
        });
        const peer = new FakePeer({ choked: false, pieces: [0, 1] });

        manager.start();
        pool.add(peer);

        expect(peer.sent[0]).toEqual({ type: 'interested' });
        expect(requestMessages(peer)).toEqual([
            { type: 'request', pieceIndex: 0, offset: 0, length: 4 },
            { type: 'request', pieceIndex: 1, offset: 0, length: 4 },
        ]);
    });

    test('writes completed pieces and resolves when the torrent is complete', async () => {
        const completions: PieceCompletion[] = [];
        const pool = new FakePeerPool();
        const manager = new DownloadManager({
            metadata: makeMetadata(),
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            writeValidatedPiece: makeWriteValidated({ completions }),
        });
        const peer = new FakePeer({ choked: false });

        manager.start();
        pool.add(peer);
        peer.emit({ type: 'piece', pieceIndex: 0, offset: 0, block: new Uint8Array([1, 2, 3, 4]) });

        expect(manager.done).resolves.toBeUndefined();
        expect(completions).toEqual([
            {
                pieceIndex: 0,
                data: new Uint8Array([1, 2, 3, 4]),
                expectedHash: new Uint8Array(20),
            },
        ]);
    });

    test('reports progress snapshots for completed pieces by default', async () => {
        const progress: DownloadProgress[] = [];
        const pool = new FakePeerPool();
        const metadata = makeMetadata({ length: 4, pieceLength: 4, pieces: 1 });
        const manager = new DownloadManager({
            metadata,
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            maxInFlightRequestsPerPeer: 2,
            planner: createPiecePlanner(metadata, { blockLength: 2 }),
            writeValidatedPiece: makeWriteValidated(),
        });
        const peer = new FakePeer({ choked: false });

        manager.onProgress((snapshot) => progress.push(snapshot));
        manager.start();
        pool.add(peer);

        peer.emit({ type: 'piece', pieceIndex: 0, offset: 0, block: new Uint8Array([1, 2]) });
        expect(progress).toEqual([]);

        peer.emit({ type: 'piece', pieceIndex: 0, offset: 2, block: new Uint8Array([3, 4]) });
        await manager.done;

        expect(progress).toEqual([
            {
                totalBytes: 4,
                receivedBytes: 4,
                downloadedBytes: 4,
                totalPieces: 1,
                completedPieces: 1,
                percent: 1,
                speedBytesPerSecond: 0,
                speed: '0.0 Bps',
            },
        ]);
    });

    test('reports progress snapshots as blocks arrive when configured', async () => {
        const progress: DownloadProgress[] = [];
        const pool = new FakePeerPool();
        const metadata = makeMetadata({ length: 4, pieceLength: 4, pieces: 1 });
        const manager = new DownloadManager({
            metadata,
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            maxInFlightRequestsPerPeer: 2,
            progressEvents: 'block',
            planner: createPiecePlanner(metadata, { blockLength: 2 }),
            writeValidatedPiece: makeWriteValidated(),
        });
        const peer = new FakePeer({ choked: false });

        expect(manager.progress).toEqual({
            totalBytes: 4,
            receivedBytes: 0,
            downloadedBytes: 0,
            totalPieces: 1,
            completedPieces: 0,
            percent: 0,
            speedBytesPerSecond: 0,
            speed: '0.0 Bps',
        });

        manager.onProgress((snapshot) => progress.push(snapshot));
        manager.start();
        pool.add(peer);

        peer.emit({ type: 'piece', pieceIndex: 0, offset: 0, block: new Uint8Array([1, 2]) });
        peer.emit({ type: 'piece', pieceIndex: 0, offset: 2, block: new Uint8Array([3, 4]) });
        await manager.done;

        expect(progress).toEqual([
            {
                totalBytes: 4,
                receivedBytes: 2,
                downloadedBytes: 0,
                totalPieces: 1,
                completedPieces: 0,
                percent: 0,
                speedBytesPerSecond: 0,
                speed: '0.0 Bps',
            },
            {
                totalBytes: 4,
                receivedBytes: 4,
                downloadedBytes: 4,
                totalPieces: 1,
                completedPieces: 1,
                percent: 1,
                speedBytesPerSecond: 0,
                speed: '0.0 Bps',
            },
        ]);
    });

    test('updates speed only after the sample interval passes', async () => {
        const progress: DownloadProgress[] = [];
        const pool = new FakePeerPool();
        const metadata = makeMetadata({ length: 4, pieceLength: 4, pieces: 1 });
        const manager = new DownloadManager({
            metadata,
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            maxInFlightRequestsPerPeer: 2,
            progressEvents: 'block',
            speedSampleIntervalMs: 1,
            planner: createPiecePlanner(metadata, { blockLength: 2 }),
            writeValidatedPiece: makeWriteValidated(),
        });
        const peer = new FakePeer({ choked: false });

        manager.onProgress((snapshot) => progress.push(snapshot));
        manager.start();
        pool.add(peer);

        peer.emit({ type: 'piece', pieceIndex: 0, offset: 0, block: new Uint8Array([1, 2]) });
        await new Promise((resolve) => setTimeout(resolve, 5));
        peer.emit({ type: 'piece', pieceIndex: 0, offset: 2, block: new Uint8Array([3, 4]) });
        await manager.done;

        expect(progress[0]!.speedBytesPerSecond).toBe(0);
        expect(progress[1]!.speedBytesPerSecond).toBeGreaterThan(0);
        expect(progress[1]!.speed).not.toBe('0.0 Bps');
    });

    test('tracks per-peer download stats as requests complete and time out', async () => {
        const pool = new FakePeerPool();
        const metadata = makeMetadata({ length: 8, pieceLength: 4, pieces: 2 });
        const manager = new DownloadManager({
            metadata,
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            maxInFlightRequestsPerPeer: 1,
            requestTimeoutMs: 20,
            writeValidatedPiece: makeWriteValidated(),
        });
        const responsivePeer = new FakePeer({ choked: false, pieces: [0] });
        const slowPeer = new FakePeer({ choked: false, pieces: [1] });

        manager.start();
        pool.add(responsivePeer);
        pool.add(slowPeer);

        responsivePeer.emit({
            type: 'piece',
            pieceIndex: 0,
            offset: 0,
            block: new Uint8Array([1, 2, 3, 4]),
        });
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(manager.getPeerStats(asPeer(responsivePeer))).toMatchObject({
            sentRequests: 1,
            receivedBytes: 4,
            receivedBlocks: 1,
            completedRequests: 1,
            completedPieces: 1,
            invalidPieces: 0,
            timedOutRequests: 0,
        });
        expect(typeof manager.getPeerStats(asPeer(responsivePeer))?.lastBlockAt).toBe('number');
        expect(
            manager.getPeerStats(asPeer(responsivePeer))?.totalRequestTimeMs,
        ).toBeGreaterThanOrEqual(0);
        expect(manager.getPeerStats(asPeer(slowPeer))).toMatchObject({
            sentRequests: 2,
            receivedBytes: 0,
            receivedBlocks: 0,
            completedRequests: 0,
            completedPieces: 0,
            invalidPieces: 0,
            timedOutRequests: 1,
            lastBlockAt: null,
            totalRequestTimeMs: 0,
        });

        manager.close();
    });

    test('retries a piece when validation fails', async () => {
        const pool = new FakePeerPool();
        const manager = new DownloadManager({
            metadata: makeMetadata(),
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            writeValidatedPiece: makeWriteValidated({ valid: false }),
        });
        const peer = new FakePeer({ choked: false });

        manager.start();
        pool.add(peer);
        peer.emit({ type: 'piece', pieceIndex: 0, offset: 0, block: new Uint8Array([1, 2, 3, 4]) });
        await nextTick();

        expect(requestMessages(peer)).toEqual([
            { type: 'request', pieceIndex: 0, offset: 0, length: 4 },
            { type: 'request', pieceIndex: 0, offset: 0, length: 4 },
        ]);
        expect(manager.getPeerStats(asPeer(peer))).toMatchObject({
            receivedBytes: 4,
            receivedBlocks: 1,
            completedRequests: 1,
            completedPieces: 0,
            invalidPieces: 1,
            sentRequests: 2,
        });
    });

    test('returns pending peer requests to the planner when a peer closes', () => {
        const pool = new FakePeerPool();
        const manager = new DownloadManager({
            metadata: makeMetadata({ length: 8, pieceLength: 4, pieces: 2 }),
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            writeValidatedPiece: makeWriteValidated(),
        });
        const firstPeer = new FakePeer({ choked: false, pieces: [0] });
        const secondPeer = new FakePeer({ choked: false, pieces: [0] });

        manager.start();
        pool.add(firstPeer);
        firstPeer.close();
        pool.add(secondPeer);

        expect(requestMessages(firstPeer)).toEqual([
            { type: 'request', pieceIndex: 0, offset: 0, length: 4 },
        ]);
        expect(requestMessages(secondPeer)).toEqual([
            { type: 'request', pieceIndex: 0, offset: 0, length: 4 },
        ]);
    });

    test('returns a request to the planner when sending to a peer fails', () => {
        const pool = new FakePeerPool();
        const manager = new DownloadManager({
            metadata: makeMetadata(),
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            writeValidatedPiece: makeWriteValidated(),
        });
        const failedPeer = new FakePeer({ choked: false, throwOnRequest: true });
        const nextPeer = new FakePeer({ choked: false });

        manager.start();
        pool.add(failedPeer);
        pool.add(nextPeer);

        expect(requestMessages(failedPeer)).toEqual([]);
        expect(requestMessages(nextPeer)).toEqual([
            { type: 'request', pieceIndex: 0, offset: 0, length: 4 },
        ]);

        manager.close();
    });

    test('requeues timed-out requests to other peers first', async () => {
        const pool = new FakePeerPool();
        const manager = new DownloadManager({
            metadata: makeMetadata({ length: 4, pieceLength: 4, pieces: 1 }),
            outputDirectory: '/tmp/download',
            peerPool: asPeerPool(pool),
            requestTimeoutMs: 50,
            writeValidatedPiece: makeWriteValidated(),
        });
        const slowPeer = new FakePeer({ choked: false, pieces: [0] });
        const nextPeer = new FakePeer({ choked: false, pieces: [0] });

        manager.start();
        pool.add(slowPeer);
        pool.add(nextPeer);
        await new Promise((resolve) => setTimeout(resolve, 60));

        expect(requestMessages(slowPeer)).toEqual([
            { type: 'request', pieceIndex: 0, offset: 0, length: 4 },
        ]);
        expect(requestMessages(nextPeer)).toEqual([
            { type: 'request', pieceIndex: 0, offset: 0, length: 4 },
        ]);
        manager.close();
    });
});
