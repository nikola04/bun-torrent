import { HANDSHAKE_LENGTH } from '@peer/consts';
import { decodeHandshake, encodeHandshake } from '@peer/handshake';
import type { PeerInfo } from '@tracker/announce';
import { concatBytes } from '@utils/buffers';
import { BunTorrentError } from '@utils/errors';
import { createConnection, type Socket } from 'node:net';
import { PeerSessionError, PeerSessionErrorCode } from './session.error';

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export type PeerSessionConnectOptions = {
    timeoutMs?: number;
};

export class PeerSession {
    private peerChoking: boolean = true;
    private peerInterested: boolean = false;

    private amChoking: boolean = true;
    private amInterested: boolean = false;

    private bitfield: Uint8Array | null = null;

    private handshakeDone: boolean = false;
    private buffer: Uint8Array = new Uint8Array(0);
    private socket: Socket | null = null;
    private closed: boolean = false;
    private rejectPendingConnect: ((error: Error) => void) | null = null;

    constructor(private readonly peer: PeerInfo) {}

    public async connect(
        infoHash: Uint8Array,
        peerId: Uint8Array,
        options: PeerSessionConnectOptions = {},
    ): Promise<void> {
        const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

        return new Promise((resolve, reject) => {
            if (this.closed) {
                reject(
                    new PeerSessionError(
                        PeerSessionErrorCode.CLOSED,
                        'Peer session is already closed',
                    ),
                );
                return;
            }

            let settled = false;

            const timeout = setTimeout(() => {
                rejectOnce(
                    new PeerSessionError(
                        PeerSessionErrorCode.CONNECT_TIMEOUT,
                        'Peer connection timed out',
                    ),
                );
            }, timeoutMs);

            const resolveOnce = () => {
                if (settled) return;

                settled = true;
                clearTimeout(timeout);
                this.rejectPendingConnect = null;
                resolve();
            };

            const rejectOnce = (error: unknown) => {
                if (settled) return;

                settled = true;
                clearTimeout(timeout);
                this.rejectPendingConnect = null;
                this.socket?.destroy();
                this.socket = null;
                reject(toPeerSessionError(error));
            };

            this.rejectPendingConnect = rejectOnce;

            const socket = createConnection({
                host: this.peer.ip,
                port: this.peer.port,
            });

            this.socket = socket;
            socket.setTimeout(timeoutMs);

            socket.once('connect', () => {
                if (this.closed) {
                    socket.destroy();
                    return;
                }

                socket.write(encodeHandshake({ infoHash, peerId }));
            });

            socket.on('data', (data) => {
                try {
                    const bytes =
                        typeof data === 'string'
                            ? new TextEncoder().encode(data)
                            : new Uint8Array(data);
                    this.handleData(bytes, infoHash, resolveOnce, rejectOnce);
                } catch (error) {
                    rejectOnce(error);
                }
            });

            socket.once('timeout', () =>
                rejectOnce(
                    new PeerSessionError(
                        PeerSessionErrorCode.CONNECT_TIMEOUT,
                        'Peer connection timed out',
                    ),
                ),
            );
            socket.once('error', rejectOnce);
            socket.once('close', () => {
                this.socket = null;
                if (!this.handshakeDone) {
                    rejectOnce(
                        new PeerSessionError(
                            PeerSessionErrorCode.SOCKET_CLOSED_BEFORE_HANDSHAKE,
                            'Socket closed before handshake',
                        ),
                    );
                }
            });
        });
    }

    public close(): void {
        this.closed = true;
        this.socket?.destroy();
        this.socket = null;
        this.rejectPendingConnect?.(
            new PeerSessionError(PeerSessionErrorCode.CLOSED, 'Peer session closed'),
        );
    }

    private handleData(
        incoming: Uint8Array,
        infoHash: Uint8Array,
        resolve: () => void,
        reject: (err: Error) => void,
    ) {
        this.buffer = concatBytes([this.buffer, incoming]);

        if (!this.handshakeDone) {
            if (this.buffer.length < HANDSHAKE_LENGTH) return;

            const handshake = decodeHandshake(this.buffer.slice(0, HANDSHAKE_LENGTH));

            if (!handshake.infoHash.every((b, i) => b === infoHash[i])) {
                reject(
                    new PeerSessionError(
                        PeerSessionErrorCode.INFO_HASH_MISMATCH,
                        'Handshake info hash does not match torrent info hash',
                    ),
                );
                return;
            }

            this.handshakeDone = true;
            this.buffer = this.buffer.slice(HANDSHAKE_LENGTH);
            resolve();
        }
    }
}

const toPeerSessionError = (error: unknown): Error => {
    if (error instanceof BunTorrentError) return error;
    if (error instanceof Error) {
        return new PeerSessionError(PeerSessionErrorCode.SOCKET_ERROR, error.message, error);
    }

    return new PeerSessionError(PeerSessionErrorCode.SOCKET_ERROR, String(error), error);
};

export { PeerSessionError, PeerSessionErrorCode } from './session.error';
