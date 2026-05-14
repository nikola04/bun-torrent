import { PeerSession, type PeerSessionConnectOptions } from '@peer/session';
import type { PeerInfo } from '@tracker/announce';
import { PeerPoolError, PeerPoolErrorCode } from './pool.error';

const DEFAULT_MAX_CONNECTING = 20;
const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;

export type PeerConnectionSession = {
    connect(
        infoHash: Uint8Array,
        peerId: Uint8Array,
        options?: PeerSessionConnectOptions,
    ): Promise<void>;
    close(): void;
};

export type PeerPoolOptions<TSession extends PeerConnectionSession = PeerSession> = {
    infoHash: Uint8Array;
    peerId: Uint8Array;
    targetConnections: number;
    minConnections?: number;
    maxConnecting?: number;
    timeoutMs?: number;
    createSession?: (peer: PeerInfo) => TSession;
};

type NormalizedPeerPoolOptions<TSession extends PeerConnectionSession> = {
    infoHash: Uint8Array;
    peerId: Uint8Array;
    targetConnections: number;
    minConnections: number;
    maxConnecting: number;
    timeoutMs: number;
    createSession: (peer: PeerInfo) => TSession;
};

export class PeerPool<TSession extends PeerConnectionSession = PeerSession> {
    private readonly connected: TSession[] = [];
    private readonly inFlight = new Set<TSession>();
    private readonly sessionListeners = new Set<(session: TSession) => void>();
    private readonly errors: unknown[] = [];

    private nextPeerIndex = 0;
    private closed = false;
    private readySettled = false;
    private doneSettled = false;

    public readonly ready: Promise<this>;
    public readonly done: Promise<TSession[]>;

    private resolveReady!: (pool: this) => void;
    private rejectReady!: (error: unknown) => void;
    private resolveDone!: (sessions: TSession[]) => void;
    private rejectDone!: (error: unknown) => void;

    public constructor(
        private readonly peers: PeerInfo[],
        private readonly options: NormalizedPeerPoolOptions<TSession>,
    ) {
        this.ready = new Promise((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });

        this.done = new Promise((resolve, reject) => {
            this.resolveDone = resolve;
            this.rejectDone = reject;
        });
        void this.done.catch(() => undefined);
    }

    public start(): void {
        this.connectNext();
        this.finishIfDone();
    }

    public get size(): number {
        return this.connected.length;
    }

    public get connecting(): number {
        return this.inFlight.size;
    }

    public get attempted(): number {
        return this.nextPeerIndex;
    }

    public get failed(): number {
        return this.errors.length;
    }

    public get totalPeers(): number {
        return this.peers.length;
    }

    public get targetConnections(): number {
        return this.options.targetConnections;
    }

    public get sessions(): TSession[] {
        return [...this.connected];
    }

    public onSession(callback: (session: TSession) => void): () => void {
        this.sessionListeners.add(callback);
        for (const session of this.connected) callback(session);

        return () => {
            this.sessionListeners.delete(callback);
        };
    }

    public close(): void {
        if (this.closed) return;

        this.closed = true;
        for (const session of this.connected) session.close();
        for (const session of this.inFlight) session.close();
        this.inFlight.clear();
        this.resolveReadyIfNeeded();
        this.resolveDoneIfNeeded();
    }

    private connectNext(): void {
        if (this.closed) return;

        while (
            this.inFlight.size < this.options.maxConnecting &&
            this.connected.length + this.inFlight.size < this.options.targetConnections &&
            this.nextPeerIndex < this.peers.length
        ) {
            const peer = this.peers[this.nextPeerIndex]!;
            this.nextPeerIndex += 1;

            const session = this.options.createSession(peer);
            this.inFlight.add(session);

            void session
                .connect(this.options.infoHash, this.options.peerId, {
                    timeoutMs: this.options.timeoutMs,
                })
                .then(() => this.handleConnected(session))
                .catch((error) => this.handleFailed(session, error));
        }
    }

    private handleConnected(session: TSession): void {
        this.inFlight.delete(session);

        if (this.closed) {
            session.close();
            this.finishIfDone();
            return;
        }

        this.connected.push(session);
        for (const listener of this.sessionListeners) listener(session);

        this.resolveReadyIfNeeded();
        this.connectNext();
        this.finishIfDone();
    }

    private handleFailed(session: TSession, error: unknown): void {
        this.inFlight.delete(session);
        session.close();
        this.errors.push(error);

        this.connectNext();
        this.finishIfDone();
    }

    private finishIfDone(): void {
        if (this.doneSettled) return;

        if (this.connected.length >= this.options.targetConnections) {
            this.doneSettled = true;
            this.resolveReadyIfNeeded();
            this.resolveDone(this.sessions);
            return;
        }

        if (this.inFlight.size > 0 || this.nextPeerIndex < this.peers.length) return;

        this.doneSettled = true;

        if (this.connected.length >= this.options.minConnections) {
            this.resolveReadyIfNeeded();
            this.resolveDone(this.sessions);
            return;
        }

        const error = new PeerPoolError(
            PeerPoolErrorCode.NO_CONNECTABLE_PEERS,
            'Not enough connectable peers',
            this.errors,
        );
        for (const session of this.connected) session.close();
        this.rejectReadyIfNeeded(error);
        this.rejectDone(error);
    }

    private resolveReadyIfNeeded(): void {
        if (this.readySettled || this.connected.length < this.options.minConnections) return;

        this.readySettled = true;
        this.resolveReady(this);
    }

    private rejectReadyIfNeeded(error: unknown): void {
        if (this.readySettled) return;

        this.readySettled = true;
        this.rejectReady(error);
    }

    private resolveDoneIfNeeded(): void {
        if (this.doneSettled) return;

        this.doneSettled = true;
        this.resolveDone(this.sessions);
    }
}

export const openPeerPool = async <TSession extends PeerConnectionSession = PeerSession>(
    peers: PeerInfo[],
    options: PeerPoolOptions<TSession>,
): Promise<PeerPool<TSession>> => {
    if (peers.length === 0) {
        throw new PeerPoolError(PeerPoolErrorCode.NO_PEERS, 'No peers to connect to');
    }

    const pool = new PeerPool(peers, normalizeOptions(options));
    pool.start();
    return await pool.ready;
};

export const connectToPeers = async <TSession extends PeerConnectionSession = PeerSession>(
    peers: PeerInfo[],
    options: PeerPoolOptions<TSession>,
): Promise<TSession[]> => {
    const pool = await openPeerPool(peers, options);
    return await pool.done;
};

const normalizeOptions = <TSession extends PeerConnectionSession>(
    options: PeerPoolOptions<TSession>,
): NormalizedPeerPoolOptions<TSession> => {
    const targetConnections = assertPositiveInteger(options.targetConnections, 'targetConnections');
    const minConnections = assertPositiveInteger(options.minConnections ?? 1, 'minConnections');
    if (minConnections > targetConnections) {
        throw new PeerPoolError(
            PeerPoolErrorCode.INVALID_OPTION,
            'minConnections cannot be greater than targetConnections',
        );
    }

    return {
        infoHash: options.infoHash,
        peerId: options.peerId,
        targetConnections,
        minConnections,
        maxConnecting: Math.max(1, options.maxConnecting ?? DEFAULT_MAX_CONNECTING),
        timeoutMs: options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        createSession:
            options.createSession ??
            ((peer: PeerInfo) => new PeerSession(peer) as unknown as TSession),
    };
};

const assertPositiveInteger = (value: number, name: string): number => {
    if (!Number.isInteger(value) || value < 1) {
        throw new PeerPoolError(
            PeerPoolErrorCode.INVALID_OPTION,
            `${name} must be a positive integer`,
        );
    }

    return value;
};

export { PeerPoolError, PeerPoolErrorCode } from './pool.error';
