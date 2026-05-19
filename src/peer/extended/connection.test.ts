import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';

import { concatBytes } from '../../utils/buffers';
import { encodeHandshake } from '../handshake';
import { openExtendedConnection } from './connection';
import { encodeExtMessage, encodeExtendedHandshake } from './protocol';

const infoHash = new Uint8Array(20).fill(1);
const peerId = new Uint8Array(20).fill(2);
const serverPeerId = new Uint8Array(20).fill(3);

describe('openExtendedConnection', () => {
    test('opens an extended connection and queues messages received before listeners attach', async () => {
        const socket = new FakeSocket();
        socket.onWrite = (data) => {
            if (socket.writes.length !== 1) return;

            expect(data.byteLength).toBeGreaterThan(0);
            socket.emitData(
                concatBytes([
                    encodeHandshake({ infoHash, peerId: serverPeerId }),
                    encodeExtendedHandshake({ ut_metadata: 7 }),
                    encodeExtMessage(1, new Uint8Array([9, 8, 7])),
                ]),
            );
        };

        const connectionPromise = openExtendedConnection({
            peer: { ip: '127.0.0.1', port: 6881 },
            infoHash,
            peerId,
            timeoutMs: 1_000,
            localExtensions: { ut_metadata: 1 },
            createSocket: () => socket,
        });

        socket.emit('connect');
        const connection = await connectionPromise;

        expect(connection.remoteExtensions).toEqual(new Map([['ut_metadata', 7]]));

        const queuedMessage = await new Promise((resolve) => {
            connection.onMessage(resolve);
        });

        expect(queuedMessage).toEqual({
            type: 'extended',
            extId: 1,
            data: new Uint8Array([9, 8, 7]),
        });

        connection.close();
    });
});

class FakeSocket extends EventEmitter {
    public writes: Uint8Array[] = [];
    public onWrite?: (data: Uint8Array) => void;

    public write(data: Uint8Array): boolean {
        this.writes.push(data);
        this.onWrite?.(data);
        return true;
    }

    public destroy(): void {
        this.emit('close');
    }

    public emitData(data: Uint8Array): void {
        this.emit('data', data);
    }
}
