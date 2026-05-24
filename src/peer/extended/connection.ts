import { createConnection } from 'node:net';

import { defaults } from '../../configs/defaults';
import type { PeerInfo } from '../../tracker';
import { concatBytes } from '../../utils/buffers';
import { HANDSHAKE_LENGTH } from '../consts';
import { decodeHandshake, encodeHandshake } from '../handshake';
import { decodePeerMessage, type PeerMessage } from '../messages';
import { PeerExtendedError, PeerExtendedErrorCode } from './errors';
import {
    EXTENDED_HANDSHAKE_ID,
    encodeExtMessage,
    encodeExtendedHandshake,
    parseExtendedHandshake,
} from './protocol';

export type ExtendedMessage = Extract<PeerMessage, { type: 'extended' }>;

export type ExtendedConnection = {
    readonly remoteExtensions: ReadonlyMap<string, number>;
    readonly metadataSize?: number;
    send(extId: number, payload: Uint8Array): void;
    onMessage(listener: (message: ExtendedMessage) => void): () => void;
    close(): void;
};

export type OpenExtendedConnectionOptions = {
    peer: PeerInfo;
    infoHash: Uint8Array;
    peerId: Uint8Array;
    timeoutMs?: number;
    signal?: AbortSignal;
    localExtensions: Record<string, number>;
    createSocket?: (peer: PeerInfo) => ExtendedSocket;
};

const EXTENSION_PROTOCOL_RESERVED_BYTE_INDEX = 5;
const EXTENSION_PROTOCOL_RESERVED_MASK = 0x10;

type ExtendedSocket = {
    on(event: 'connect', listener: () => void): void;
    on(event: 'data', listener: (data: string | Uint8Array<ArrayBufferLike>) => void): void;
    on(event: 'error', listener: (error: unknown) => void): void;
    on(event: 'close', listener: () => void): void;
    write(data: Uint8Array): unknown;
    destroy(): void;
    unref?(): void;
};

export const openExtendedConnection = async ({
    peer,
    infoHash,
    peerId,
    timeoutMs = defaults.peers.connectTimeoutMs,
    signal,
    localExtensions,
    createSocket = ({ ip, port }) => createConnection({ host: ip, port }),
}: OpenExtendedConnectionOptions): Promise<ExtendedConnection> => {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createAbortedError());
            return;
        }

        const socket = createSocket(peer);

        let settled = false;
        let closed = false;
        let handshakeDone = false;
        let buffer: Uint8Array = new Uint8Array(0);
        let remoteExtensions = new Map<string, number>();
        let metadataSize: number | undefined;
        const listeners = new Set<(message: ExtendedMessage) => void>();
        const queuedMessages: ExtendedMessage[] = [];

        const timeout = setTimeout(() => {
            rejectOnce(
                new PeerExtendedError(
                    PeerExtendedErrorCode.CONNECTION_TIMEOUT,
                    'Peer extended connection timed out',
                ),
            );
        }, timeoutMs);
        timeout.unref();

        const cleanup = (): void => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
        };

        const connection: ExtendedConnection = {
            get remoteExtensions() {
                return remoteExtensions;
            },
            get metadataSize() {
                return metadataSize;
            },
            send(extId, payload) {
                socket.write(encodeExtMessage(extId, payload));
            },
            onMessage(listener) {
                listeners.add(listener);

                for (const message of queuedMessages.splice(0)) {
                    listener(message);
                }

                return () => {
                    listeners.delete(listener);
                };
            },
            close() {
                closed = true;
                cleanup();
                socket.unref?.();
                socket.destroy();
            },
        };

        const resolveOnce = (): void => {
            if (settled) return;

            settled = true;
            cleanup();
            resolve(connection);
        };

        const rejectOnce = (error: unknown): void => {
            if (settled) return;

            settled = true;
            closed = true;
            cleanup();
            socket.unref?.();
            socket.destroy();
            reject(error);
        };

        const abort = (): void => {
            rejectOnce(createAbortedError());
        };

        signal?.addEventListener('abort', abort, { once: true });

        socket.on('connect', () => {
            const reserved = new Uint8Array(8);
            reserved[EXTENSION_PROTOCOL_RESERVED_BYTE_INDEX] =
                (reserved[EXTENSION_PROTOCOL_RESERVED_BYTE_INDEX] ?? 0) |
                EXTENSION_PROTOCOL_RESERVED_MASK;

            socket.write(encodeHandshake({ infoHash, peerId, reserved }));
        });

        socket.on('data', (data) => {
            try {
                buffer = concatBytes([buffer, toBytes(data)]);

                if (!handshakeDone) {
                    if (buffer.byteLength < HANDSHAKE_LENGTH) return;

                    const handshake = decodeHandshake(buffer.slice(0, HANDSHAKE_LENGTH));
                    if (!handshake.infoHash.every((b, i) => b === infoHash[i])) {
                        rejectOnce(
                            new PeerExtendedError(
                                PeerExtendedErrorCode.INFO_HASH_MISMATCH,
                                'Handshake info hash does not match torrent info hash',
                            ),
                        );
                        return;
                    }

                    handshakeDone = true;
                    buffer = new Uint8Array(buffer.slice(HANDSHAKE_LENGTH));
                    socket.write(encodeExtendedHandshake(localExtensions));
                }

                readPeerFrames(buffer, (remaining, message) => {
                    buffer = remaining;
                    handlePeerMessage(message, {
                        onHandshake: (extensions, size) => {
                            remoteExtensions = extensions;
                            metadataSize = size;
                            resolveOnce();
                        },
                        onExtendedMessage: emitMessage,
                    });
                });
            } catch (error) {
                rejectOnce(error);
            }
        });

        socket.on('error', rejectOnce);
        socket.on('close', () => {
            if (closed || settled) return;

            rejectOnce(
                new PeerExtendedError(
                    PeerExtendedErrorCode.CONNECTION_CLOSED,
                    'Peer extended connection closed before extended handshake',
                ),
            );
        });

        const emitMessage = (message: ExtendedMessage): void => {
            if (listeners.size === 0) {
                queuedMessages.push(message);
                return;
            }

            for (const listener of listeners) listener(message);
        };
    });
};

const createAbortedError = (): PeerExtendedError =>
    new PeerExtendedError(PeerExtendedErrorCode.ABORTED, 'Peer extended connection aborted');

const toBytes = (data: string | Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> =>
    typeof data === 'string' ? new TextEncoder().encode(data) : data;

const readPeerFrames = (
    initialBuffer: Uint8Array<ArrayBufferLike>,
    onMessage: (remaining: Uint8Array<ArrayBufferLike>, message: PeerMessage) => void,
): void => {
    let buffer = initialBuffer;

    while (buffer.byteLength >= 4) {
        const frameLength = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0, false);
        const totalLength = 4 + frameLength;

        if (buffer.byteLength < totalLength) return;

        const frame = buffer.slice(0, totalLength);
        buffer = new Uint8Array(buffer.slice(totalLength));
        onMessage(buffer, decodePeerMessage(frame));
    }
};

const handlePeerMessage = (
    message: PeerMessage,
    handlers: {
        onHandshake: (extensions: Map<string, number>, metadataSize?: number) => void;
        onExtendedMessage: (message: ExtendedMessage) => void;
    },
): void => {
    if (message.type !== 'extended') return;

    if (message.extId === EXTENDED_HANDSHAKE_ID) {
        const handshake = parseExtendedHandshake(message.data);
        handlers.onHandshake(handshake.extensions, handshake.metadataSize);
        return;
    }

    handlers.onExtendedMessage(message);
};
