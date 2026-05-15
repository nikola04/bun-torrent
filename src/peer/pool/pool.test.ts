import { describe, expect, test } from 'bun:test';

import type { PeerInfo } from '@tracker/types';
import {
    connectToPeers,
    openPeerPool,
    PeerPoolError,
    PeerPoolErrorCode,
    type PeerConnectionSession,
} from '.';
import { BunTorrentError } from '@utils/errors';

const bytes20 = new Uint8Array(20);

describe('openPeerPool', () => {
    test('returns as soon as minConnections is satisfied and keeps refilling in the background', async () => {
        const peers = makePeers(5);
        const activity = { current: 0, max: 0 };
        const outcomes = new Map([
            ['10.0.0.1', { delayMs: 1, succeeds: true }],
            ['10.0.0.2', { delayMs: 5, succeeds: false }],
            ['10.0.0.3', { delayMs: 8, succeeds: true }],
            ['10.0.0.4', { delayMs: 10, succeeds: true }],
            ['10.0.0.5', { delayMs: 1, succeeds: true }],
        ]);

        const pool = await openPeerPool(peers, {
            infoHash: bytes20,
            peerId: bytes20,
            targetConnections: 3,
            minConnections: 1,
            maxConnecting: 2,
            createSession(peer) {
                return new FakeSession(peer, outcomes.get(peer.ip)!, activity);
            },
        });

        expect(pool.size).toBe(1);
        expect(activity.max).toBeLessThanOrEqual(2);

        const sessions = await pool.done;
        expect(sessions).toHaveLength(3);
        expect(sessions.map((session) => session.peer.ip)).toEqual([
            '10.0.0.1',
            '10.0.0.3',
            '10.0.0.4',
        ]);
    });

    test('notifies listeners when new sessions are added', async () => {
        const seen: string[] = [];
        const pool = await openPeerPool(makePeers(3), {
            infoHash: bytes20,
            peerId: bytes20,
            targetConnections: 2,
            minConnections: 1,
            maxConnecting: 1,
            createSession(peer) {
                return new FakeSession(
                    peer,
                    { delayMs: peer.ip === '10.0.0.1' ? 1 : 3, succeeds: true },
                    { current: 0, max: 0 },
                );
            },
        });

        const off = pool.onSession((session) => seen.push(session.peer.ip));
        await pool.done;
        off();

        expect(seen).toEqual(['10.0.0.1', '10.0.0.2']);
    });

    test('rejects when minConnections cannot be satisfied', async () => {
        expect(
            openPeerPool(makePeers(2), {
                infoHash: bytes20,
                peerId: bytes20,
                targetConnections: 2,
                minConnections: 1,
                maxConnecting: 2,
                createSession(peer) {
                    return new FakeSession(
                        peer,
                        { delayMs: 1, succeeds: false },
                        { current: 0, max: 0 },
                    );
                },
            }),
        ).rejects.toThrow('Not enough connectable peers');

        expect(
            openPeerPool(makePeers(2), {
                infoHash: bytes20,
                peerId: bytes20,
                targetConnections: 2,
                minConnections: 1,
                maxConnecting: 2,
                createSession(peer) {
                    return new FakeSession(
                        peer,
                        { delayMs: 1, succeeds: false },
                        { current: 0, max: 0 },
                    );
                },
            }),
        ).rejects.toMatchObject({
            code: PeerPoolErrorCode.NO_CONNECTABLE_PEERS,
        });
    });

    test('allows zero minimum connections and reports failed attempts through stats', async () => {
        const pool = await openPeerPool(makePeers(2), {
            infoHash: bytes20,
            peerId: bytes20,
            targetConnections: 2,
            minConnections: 0,
            maxConnecting: 2,
            createSession(peer) {
                return new FakeSession(
                    peer,
                    { delayMs: 1, succeeds: false },
                    { current: 0, max: 0 },
                );
            },
        });

        expect(pool.size).toBe(0);

        const sessions = await pool.done;
        expect(sessions).toEqual([]);
        expect(pool.failed).toBe(2);
    });

    test('allows empty peer lists when zero connections are required', async () => {
        const pool = await openPeerPool([], {
            infoHash: bytes20,
            peerId: bytes20,
            targetConnections: 2,
            minConnections: 0,
        });

        expect(pool.totalPeers).toBe(0);
        expect(await pool.done).toEqual([]);
    });
});

describe('connectToPeers', () => {
    test('waits until targetConnections is reached', async () => {
        const sessions = await connectToPeers(makePeers(3), {
            infoHash: bytes20,
            peerId: bytes20,
            targetConnections: 2,
            minConnections: 1,
            maxConnecting: 1,
            createSession(peer) {
                return new FakeSession(
                    peer,
                    { delayMs: 1, succeeds: true },
                    { current: 0, max: 0 },
                );
            },
        });

        expect(sessions).toHaveLength(2);
    });

    test('returns partial sessions when minConnections is satisfied and peers are exhausted', async () => {
        const sessions = await connectToPeers(makePeers(3), {
            infoHash: bytes20,
            peerId: bytes20,
            targetConnections: 3,
            minConnections: 2,
            maxConnecting: 3,
            createSession(peer) {
                return new FakeSession(
                    peer,
                    { delayMs: 1, succeeds: peer.ip !== '10.0.0.2' },
                    { current: 0, max: 0 },
                );
            },
        });

        expect(sessions).toHaveLength(2);
        expect(sessions.map((session) => session.peer.ip)).toEqual(['10.0.0.1', '10.0.0.3']);
    });

    test('rejects invalid connection counts', async () => {
        expect(
            connectToPeers(makePeers(1), {
                infoHash: bytes20,
                peerId: bytes20,
                targetConnections: 0,
            }),
        ).rejects.toThrow('targetConnections must be a positive integer');
        expect(
            connectToPeers(makePeers(1), {
                infoHash: bytes20,
                peerId: bytes20,
                targetConnections: 0,
            }),
        ).rejects.toBeInstanceOf(PeerPoolError);
        expect(
            connectToPeers(makePeers(1), {
                infoHash: bytes20,
                peerId: bytes20,
                targetConnections: 0,
            }),
        ).rejects.toBeInstanceOf(BunTorrentError);

        expect(
            connectToPeers(makePeers(1), {
                infoHash: bytes20,
                peerId: bytes20,
                targetConnections: 1,
                minConnections: 2,
            }),
        ).rejects.toThrow('minConnections cannot be greater than targetConnections');
        expect(
            connectToPeers(makePeers(1), {
                infoHash: bytes20,
                peerId: bytes20,
                targetConnections: 1,
                minConnections: 2,
            }),
        ).rejects.toMatchObject({
            code: PeerPoolErrorCode.INVALID_OPTION,
        });
    });
});

const makePeers = (count: number): PeerInfo[] =>
    Array.from({ length: count }, (_, index) => ({
        ip: `10.0.0.${index + 1}`,
        port: 6881 + index,
    }));

class FakeSession implements PeerConnectionSession {
    public closed = false;
    private settled = false;
    private rejectConnect: ((error: Error) => void) | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        public readonly peer: PeerInfo,
        private readonly outcome: { delayMs: number; succeeds: boolean },
        private readonly activity: { current: number; max: number },
    ) {}

    public async connect(): Promise<void> {
        this.activity.current += 1;
        this.activity.max = Math.max(this.activity.max, this.activity.current);

        return new Promise((resolve, reject) => {
            this.rejectConnect = reject;
            this.timer = setTimeout(() => {
                if (this.settled) return;

                this.settled = true;
                this.activity.current -= 1;
                if (this.outcome.succeeds) resolve();
                else reject(new Error('Fake connect failed'));
            }, this.outcome.delayMs);
        });
    }

    public close(): void {
        if (this.closed) return;

        this.closed = true;
        if (this.settled) return;

        this.settled = true;
        if (this.timer) clearTimeout(this.timer);
        this.activity.current -= 1;
        this.rejectConnect?.(new Error('Fake session closed'));
    }
}
