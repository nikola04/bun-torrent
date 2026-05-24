import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';

import { encodeBencode, toBValue } from '../../../torrent';
import { concatBytes } from '../../../utils/buffers';
import { sha1 } from '../../../utils/sha1';
import { encodeHandshake } from '../../handshake';
import { decodePeerMessage } from '../../messages';
import { PeerExtendedErrorCode } from '../errors';
import { encodeExtMessage } from '../protocol';
import { encodeMetadataRequest } from './messages';
import { fetchMetadataFromPeer } from '.';

const peerId = new Uint8Array(20).fill(2);
const serverPeerId = new Uint8Array(20).fill(3);

describe('fetchMetadataFromPeer', () => {
    test('fetches and validates metadata from a peer using ut_metadata', async () => {
        const metadata = encodeBencode(
            toBValue({
                name: 'file.bin',
                'piece length': 16_384,
                pieces: new Uint8Array(20),
                length: 4,
            }),
        );
        const infoHash = sha1(metadata);
        const socket = new FakeSocket();
        const requestExtIds: number[] = [];

        socket.onWrite = (data) => {
            const message = tryDecodePeerMessage(data);

            if (socket.writes.length === 1) {
                socket.emitData(
                    concatBytes([
                        encodeHandshake({ infoHash, peerId: serverPeerId }),
                        encodeExtMessage(
                            0,
                            encodeBencode(
                                toBValue({
                                    m: { ut_metadata: 7 },
                                    metadata_size: metadata.byteLength,
                                }),
                            ),
                        ),
                    ]),
                );
                return;
            }

            if (message?.type !== 'extended' || message.extId !== 7) return;

            expect(message.data).toEqual(encodeMetadataRequest(0));
            requestExtIds.push(message.extId);
            socket.emitData(
                encodeExtMessage(
                    1,
                    concatBytes([
                        encodeBencode(
                            toBValue({
                                msg_type: 1,
                                piece: 0,
                                total_size: metadata.byteLength,
                            }),
                        ),
                        metadata,
                    ]),
                ),
            );
        };

        const parsed = await fetchMetadataFromPeer(
            { ip: '127.0.0.1', port: 6881 },
            infoHash,
            peerId,
            {
                timeoutMs: 1_000,
                createSocket: () => {
                    queueMicrotask(() => socket.emit('connect'));
                    return socket;
                },
            },
        );

        expect(parsed).toBeInstanceOf(Map);
        expect((parsed as Map<string, unknown>).get('length')).toBe(4);
        expect(requestExtIds).toEqual([7]);
    });

    test('closes the connection when metadata download is aborted', async () => {
        const metadata = encodeBencode(
            toBValue({
                name: 'file.bin',
                'piece length': 16_384,
                pieces: new Uint8Array(20),
                length: 4,
            }),
        );
        const infoHash = sha1(metadata);
        const socket = new FakeSocket();
        const controller = new AbortController();

        socket.onWrite = () => {
            if (socket.writes.length !== 1) return;

            socket.emitData(
                concatBytes([
                    encodeHandshake({ infoHash, peerId: serverPeerId }),
                    encodeExtMessage(
                        0,
                        encodeBencode(
                            toBValue({
                                m: { ut_metadata: 7 },
                                metadata_size: metadata.byteLength,
                            }),
                        ),
                    ),
                ]),
            );
        };

        const metadataPromise = fetchMetadataFromPeer(
            { ip: '127.0.0.1', port: 6881 },
            infoHash,
            peerId,
            {
                timeoutMs: 1_000,
                signal: controller.signal,
                createSocket: () => {
                    queueMicrotask(() => socket.emit('connect'));
                    return socket;
                },
            },
        );

        await waitFor(() => socket.writes.length > 1);
        controller.abort();

        await expect(metadataPromise).rejects.toMatchObject({
            code: PeerExtendedErrorCode.ABORTED,
        });
        expect(socket.destroyed).toBe(true);
    });
});

class FakeSocket extends EventEmitter {
    public writes: Uint8Array[] = [];
    public onWrite?: (data: Uint8Array) => void;
    public destroyed = false;

    public write(data: Uint8Array): boolean {
        this.writes.push(data);
        this.onWrite?.(data);
        return true;
    }

    public destroy(): void {
        this.destroyed = true;
        this.emit('close');
    }

    public emitData(data: Uint8Array): void {
        this.emit('data', data);
    }
}

const tryDecodePeerMessage = (data: Uint8Array) => {
    try {
        return decodePeerMessage(data);
    } catch {
        return undefined;
    }
};

const waitFor = async (predicate: () => boolean): Promise<void> => {
    for (let i = 0; i < 10; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
};
