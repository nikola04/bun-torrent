import { HANDSHAKE_LENGTH } from '../consts';
import { decodeHandshake, encodeHandshake } from '../handshake';
import { decodePeerMessage, encodePeerMessage, type PeerMessage } from '../messages';
import { PeerPieceAvailability } from '../availability';
import type { PeerInfo } from '../../tracker/types';
import { concatBytes } from '../../utils/buffers';
import { BunTorrentError } from '../../utils/errors';
import { createConnection, type Socket } from 'node:net';
import { PeerSessionError, PeerSessionErrorCode } from './session.error';
import { defaults } from '../../configs/defaults';

export type PeerSessionConnectOptions = {
    timeoutMs?: number;
    totalPieces?: number;
};

export class PeerSession {
    private peerChoking: boolean = true;
    private peerInterested: boolean = false;

    private amChoking: boolean = true;
    private amInterested: boolean = false;

    private availability = new PeerPieceAvailability(0);
    private readonly messageListeners = new Set<(message: PeerMessage) => void>();
    private readonly closeListeners = new Set<() => void>();

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
        const timeoutMs = options.timeoutMs ?? defaults.peers.connectTimeoutMs;
        this.availability = new PeerPieceAvailability(options.totalPieces ?? 0);

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
                this.notifyClosed();
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
        if (this.closed) return;

        this.closed = true;
        this.socket?.destroy();
        this.socket = null;
        this.rejectPendingConnect?.(
            new PeerSessionError(PeerSessionErrorCode.CLOSED, 'Peer session closed'),
        );
        this.notifyClosed();
    }

    public get peerAvailability(): PeerPieceAvailability {
        return this.availability;
    }

    public get choked(): boolean {
        return this.peerChoking;
    }

    public get interested(): boolean {
        return this.amInterested;
    }

    public onMessage(callback: (message: PeerMessage) => void): () => void {
        this.messageListeners.add(callback);

        return () => {
            this.messageListeners.delete(callback);
        };
    }

    public onClose(callback: () => void): () => void {
        this.closeListeners.add(callback);

        return () => {
            this.closeListeners.delete(callback);
        };
    }

    public sendMessage(message: PeerMessage): void {
        if (this.closed || !this.socket) {
            throw new PeerSessionError(PeerSessionErrorCode.CLOSED, 'Peer session closed');
        }

        if (message.type === 'interested') this.amInterested = true;
        if (message.type === 'not-interested') this.amInterested = false;

        this.socket.write(encodePeerMessage(message));
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

        while (this.handshakeDone && this.buffer.byteLength >= 4) {
            const frameLength = new DataView(
                this.buffer.buffer,
                this.buffer.byteOffset,
                4,
            ).getUint32(0, false);

            const maxPeerMessageLength = 1 + 8 + defaults.pieces.blockSize; // add 4 bytes prefix
            if (frameLength > maxPeerMessageLength) {
                this.close();
                return;
            }

            const totalLength = 4 + frameLength;

            if (this.buffer.byteLength < totalLength) return;

            const frame = this.buffer.slice(0, totalLength);
            this.buffer = this.buffer.slice(totalLength);
            this.handleMessage(decodePeerMessage(frame));
        }
    }

    private handleMessage(message: PeerMessage): void {
        switch (message.type) {
            case 'choke':
                this.peerChoking = true;
                break;
            case 'unchoke':
                this.peerChoking = false;
                break;
            case 'interested':
                this.peerInterested = true;
                break;
            case 'not-interested':
                this.peerInterested = false;
                break;
            case 'bitfield':
                this.availability.setBitfield(message.bitfield);
                break;
            case 'have':
                this.availability.markHave(message.pieceIndex);
                break;
        }

        for (const listener of this.messageListeners) listener(message);
    }

    private notifyClosed(): void {
        for (const listener of this.closeListeners) listener();
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
