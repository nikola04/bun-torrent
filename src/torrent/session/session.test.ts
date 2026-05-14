import { describe, expect, test } from 'bun:test';

import { Torrent } from '.';
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

    public onSession(): () => void {
        return () => undefined;
    }

    public close(): void {
        this.closed = true;
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
