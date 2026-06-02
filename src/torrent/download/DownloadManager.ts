import type { PeerMessage } from '../../peer/messages';
import type { PeerPool } from '../../peer/pool';
import type { PeerSession } from '../../peer/session';
import type { PieceBlockRequest, PieceCompletion, PiecePlanner } from '../pieces';
import { createPiecePlanner } from '../pieces';
import type { TorrentMetadata } from '../types';
import { writeValidatedPiece, type WritePieceOptions } from '../storage';
import { formatBytes } from '../../utils/formats';
import type { TorrentFileSelection } from '../file-selection';
import { getSelectedPieceIndexes } from '../file-selection';
import { PeerScorer, type PeerDownloadStats } from './PeerScorer';
import { defaults } from '../../configs/defaults';

export type DownloadManagerOptions = {
    metadata: TorrentMetadata;
    outputDirectory: string;
    peerPool: PeerPool;
    files?: TorrentFileSelection;
    maxInFlightRequestsPerPeer?: number;
    progressEvents?: DownloadProgressEventMode;
    requestTimeoutMs?: number;
    speedSampleIntervalMs?: number;
    planner?: PiecePlanner;
    writeValidatedPiece?: typeof writeValidatedPiece;
};

/** Controls how often a {@link Torrent} emits `progress` events. */
export type DownloadProgressEventMode = 'piece' | 'block';

/**
 * Progress snapshot returned by {@link Torrent.progress} and the `progress` event payload.
 */
export type DownloadProgress = {
    /** Total bytes in the selected files. */
    totalBytes: number;
    /** Bytes received from peers across all pieces (includes pieces still pending validation). */
    receivedBytes: number;
    /** Bytes from pieces that have passed SHA-1 validation and been written to disk. */
    downloadedBytes: number;
    /** Total pieces selected for this download. */
    totalPieces: number;
    /** Pieces that have completed validation. */
    completedPieces: number;
    /** Validated progress, `downloadedBytes / totalBytes`, in the range `[0, 1]`. */
    percent: number;
    /** Smoothed download rate in bytes per second. */
    speedBytesPerSecond: number;
    /** Pre-formatted version of `speedBytesPerSecond`, e.g. `"1.4 MBps"`. */
    speed: string;
};

export type DownloadProgressListener = (progress: DownloadProgress) => void;

type PeerDownloadState = {
    peer: PeerSession;
    pending: PendingPeerRequest[];
    interestedSent: boolean;
    stats: PeerDownloadStats;
    availablePieces: Set<number>;
    offClose: () => void;
    offMessage: () => void;
};

type PendingPeerRequest = {
    request: PieceBlockRequest;
    timeout: ReturnType<typeof setTimeout>;
    requestedAt: number;
};

export class DownloadManager {
    public readonly done: Promise<void>;

    private readonly planner: PiecePlanner;
    private readonly maxInFlightRequestsPerPeer: number;
    private readonly progressEvents: DownloadProgressEventMode;
    private readonly requestTimeoutMs: number;
    private readonly speedSampleIntervalMs: number;
    private readonly peerStates = new Map<PeerSession, PeerDownloadState>();
    private readonly progressListeners = new Set<DownloadProgressListener>();
    private readonly writeValidated: typeof writeValidatedPiece;
    private readonly pieceAvailability = new Map<number, number>();
    private offSession: (() => void) | null = null;
    private lastProgressSample: { receivedBytes: number; timestampMs: number } | null = null;
    private currentSpeedBytesPerSecond = 0;
    private closed = false;
    private resolveDone!: () => void;
    private rejectDone!: (error: unknown) => void;

    private readonly peerScorer = new PeerScorer();

    public constructor(private readonly options: DownloadManagerOptions) {
        this.planner =
            options.planner ??
            createPiecePlanner(options.metadata, {
                pieceIndexes: getSelectedPieceIndexes(options.metadata, options.files),
            });
        this.maxInFlightRequestsPerPeer =
            options.maxInFlightRequestsPerPeer ?? defaults.download.maxInFlightRequestsPerPeer;
        this.progressEvents = options.progressEvents ?? defaults.progress.events;
        this.requestTimeoutMs = options.requestTimeoutMs ?? defaults.download.requestTimeoutMs;
        this.speedSampleIntervalMs =
            options.speedSampleIntervalMs ?? defaults.progress.speedSampleIntervalMs;
        this.writeValidated = options.writeValidatedPiece ?? writeValidatedPiece;
        this.done = new Promise((resolve, reject) => {
            this.resolveDone = resolve;
            this.rejectDone = reject;
        });
    }

    public get progress(): DownloadProgress {
        const totals = this.getProgressTotals();

        return {
            ...totals,
            percent: totals.totalBytes === 0 ? 1 : totals.downloadedBytes / totals.totalBytes,
            speedBytesPerSecond: this.currentSpeedBytesPerSecond,
            speed: `${formatBytes(this.currentSpeedBytesPerSecond)}ps`,
        };
    }

    private getProgressTotals(): Pick<
        DownloadProgress,
        'totalBytes' | 'receivedBytes' | 'downloadedBytes' | 'totalPieces' | 'completedPieces'
    > {
        let receivedBytes = 0;
        let downloadedBytes = 0;
        let totalBytes = 0;

        for (const pieceIndex of this.planner.pieceIndexes) {
            const piece = this.planner.getProgress(pieceIndex);
            totalBytes += piece.length;
            receivedBytes += piece.receivedBytes;
            if (piece.status === 'complete') downloadedBytes += piece.length;
        }

        return {
            totalBytes,
            receivedBytes,
            downloadedBytes,
            totalPieces: this.planner.totalPieces,
            completedPieces: this.planner.completedPieces,
        };
    }

    public start(): void {
        if (this.closed || this.offSession) return;

        // The peer pool may already have connected sessions, so onSession is both a replay and a subscription.
        this.offSession = this.options.peerPool.onSession((session) => this.attachPeer(session));
        void this.options.peerPool.done?.then((sessions) => {
            if (sessions.length === 0) this.resolveDone();
        });
        this.resolveIfComplete();
    }

    public onProgress(listener: DownloadProgressListener): () => void {
        this.progressListeners.add(listener);

        return () => {
            this.progressListeners.delete(listener);
        };
    }

    public getPeerStats(peer: PeerSession): PeerDownloadStats | undefined {
        const stats = this.peerStates.get(peer)?.stats;
        if (!stats) return undefined;

        return { ...stats };
    }

    public close(): void {
        if (this.closed) return;

        this.closed = true;
        this.offSession?.();
        this.offSession = null;

        for (const state of this.peerStates.values()) {
            this.detachPeer(state);
        }
        this.peerStates.clear();
        this.resolveDone();
    }

    private attachPeer(peer: PeerSession): void {
        if (this.closed || this.peerStates.has(peer)) return;

        const state: PeerDownloadState = {
            peer,
            pending: [],
            interestedSent: false,
            stats: createInitialPeerStats(),
            availablePieces: new Set(peer.peerAvailability.toPieceIndexes()),
            offClose: peer.onClose(() => this.handlePeerClosed(peer)),
            offMessage: peer.onMessage((message) => this.handlePeerMessage(peer, message)),
        };

        state.availablePieces.forEach((index) => this.incrementPieceAvailability(index));
        this.peerStates.set(peer, state);
        this.pumpPeer(state);
    }

    private detachPeer(state: PeerDownloadState): void {
        state.offClose();
        state.offMessage();
        // Any in-flight blocks owned by this peer must become available for another peer.
        this.clearPendingTimeouts(state.pending);
        this.planner.resetPeerRequests(state.pending.map((pending) => pending.request));
        state.pending = [];

        state.availablePieces.forEach((index) => this.decrementPieceAvailability(index));
    }

    private handlePeerClosed(peer: PeerSession): void {
        const state = this.peerStates.get(peer);
        if (!state) return;

        this.detachPeer(state);
        this.peerStates.delete(peer);
    }

    private syncPeerAvailability(state: PeerDownloadState): void {
        const nextAvailablePieces = new Set(state.peer.peerAvailability.toPieceIndexes());

        for (const pieceIndex of nextAvailablePieces) {
            if (!state.availablePieces.has(pieceIndex)) {
                this.incrementPieceAvailability(pieceIndex);
            }
        }

        for (const pieceIndex of state.availablePieces) {
            if (!nextAvailablePieces.has(pieceIndex)) {
                this.decrementPieceAvailability(pieceIndex);
            }
        }

        state.availablePieces = nextAvailablePieces;
    }

    private incrementPieceAvailability(pieceIndex: number): void {
        this.pieceAvailability.set(pieceIndex, (this.pieceAvailability.get(pieceIndex) ?? 0) + 1);
    }

    private decrementPieceAvailability(pieceIndex: number): void {
        const availability = this.pieceAvailability.get(pieceIndex) ?? 0;

        if (availability <= 1) {
            this.pieceAvailability.delete(pieceIndex);
            return;
        }

        this.pieceAvailability.set(pieceIndex, availability - 1);
    }

    private handlePeerMessage(peer: PeerSession, message: PeerMessage): void {
        const state = this.peerStates.get(peer);
        if (!state || this.closed) return;

        if (message.type === 'have' || message.type === 'bitfield') {
            this.syncPeerAvailability(state);
            this.pumpPeer(state);
            return;
        }

        // Choke changes are scheduling signals even when no block data arrived.
        if (message.type === 'unchoke') {
            this.pumpPeer(state);
            return;
        }

        if (message.type === 'piece') {
            this.handlePiece(state, message).catch((error) => this.rejectDone(error));
        }
    }

    private async handlePiece(
        state: PeerDownloadState,
        message: Extract<PeerMessage, { type: 'piece' }>,
    ): Promise<void> {
        const pending = this.takePendingPieceRequest(state, message);
        if (!pending) return;

        this.recordReceivedBlock(state, pending, message);

        const completion = this.planner.receiveBlock(message);

        if (completion) {
            await this.handleCompletion(state, completion);
            this.emitProgress();
        } else if (this.progressEvents === 'block') {
            this.emitProgress();
        }

        this.pumpPeer(state);
        this.resolveIfComplete();
    }

    private async handleCompletion(
        state: PeerDownloadState,
        completion: PieceCompletion,
    ): Promise<void> {
        const result = await this.writeValidated(this.options.metadata, completion, {
            outputDirectory: this.options.outputDirectory,
            files: this.options.files,
        } satisfies WritePieceOptions);

        if (!result.valid) {
            state.stats.invalidPieces += 1;
            this.resetPieceForRetry(completion.pieceIndex);
            return;
        }

        state.stats.completedPieces += 1;
    }

    private pumpPeer(state: PeerDownloadState): void {
        if (this.closed || this.planner.complete) return;

        this.sendInterestedIfUseful(state);
        if (state.peer.choked) return;

        // The scorer can throttle unreliable peers without disconnecting them.
        const requestLimit = this.getPeerRequestLimit(state);

        while (state.pending.length < requestLimit) {
            const request = this.planner.nextRequest(
                state.peer.peerAvailability,
                this.pieceAvailability,
            );
            if (!request) break;

            if (!this.sendRequest(state, request)) break;
        }
    }

    private handleRequestTimeout(state: PeerDownloadState, request: PieceBlockRequest): void {
        if (this.closed || this.planner.complete) return;

        const pending = this.takePendingRequest(state, request);
        if (!pending) return;

        // Prefer retrying timed-out work on other peers before giving the same peer another slot.
        state.stats.timedOutRequests += 1;
        this.planner.resetPending(request);
        this.pumpPeers(state);
    }

    private sendInterestedIfUseful(state: PeerDownloadState): void {
        if (state.interestedSent) return;
        if (!this.hasUsefulRequest(state)) return;

        state.peer.sendMessage({ type: 'interested' });
        state.interestedSent = true;
    }

    private hasUsefulRequest(state: PeerDownloadState): boolean {
        return this.planner.nextRequest(state.peer.peerAvailability) !== undefined;
    }

    private getPeerRequestLimit(state: PeerDownloadState): number {
        return this.peerScorer.getRequestLimit(state.stats, this.maxInFlightRequestsPerPeer);
    }

    private sendRequest(state: PeerDownloadState, request: PieceBlockRequest): boolean {
        this.planner.markPending(request);

        // Keep the timer tied to this exact request so late blocks can cancel it deterministically.
        const timeout = setTimeout(
            () => this.handleRequestTimeout(state, request),
            this.requestTimeoutMs,
        );
        timeout.unref();

        state.pending.push({
            request,
            timeout,
            requestedAt: Date.now(),
        });
        state.stats.sentRequests += 1;

        try {
            state.peer.sendMessage(request);
            return true;
        } catch {
            this.rollbackFailedSend(state, request);
            this.handlePeerClosed(state.peer);
            this.pumpPeers();
            return false;
        }
    }

    private rollbackFailedSend(state: PeerDownloadState, request: PieceBlockRequest): void {
        const pending = this.takePendingRequest(state, request);
        if (!pending) return;

        this.planner.resetPending(request);
    }

    private takePendingPieceRequest(
        state: PeerDownloadState,
        message: Extract<PeerMessage, { type: 'piece' }>,
    ): PendingPeerRequest | null {
        return this.takePendingRequest(state, {
            type: 'request',
            pieceIndex: message.pieceIndex,
            offset: message.offset,
            length: message.block.byteLength,
        });
    }

    private takePendingRequest(
        state: PeerDownloadState,
        request: PieceBlockRequest,
    ): PendingPeerRequest | null {
        const pendingIndex = state.pending.findIndex((pending) =>
            isSameRequest(pending.request, request),
        );
        if (pendingIndex === -1) return null;

        const [pending] = state.pending.splice(pendingIndex, 1);
        if (!pending) return null;

        clearTimeout(pending.timeout);
        return pending;
    }

    private resetPieceForRetry(pieceIndex: number): void {
        this.planner.resetPiece(pieceIndex);

        // A bad piece invalidates every pending block for that piece, across all peers.
        for (const state of this.peerStates.values()) {
            this.dropPendingRequestsForPiece(state, pieceIndex);
        }
    }

    private dropPendingRequestsForPiece(state: PeerDownloadState, pieceIndex: number): void {
        const kept: PendingPeerRequest[] = [];

        for (const pending of state.pending) {
            if (pending.request.pieceIndex === pieceIndex) {
                clearTimeout(pending.timeout);
                continue;
            }

            kept.push(pending);
        }

        state.pending = kept;
    }

    private pumpPeers(last?: PeerDownloadState): void {
        const states = [...this.peerStates.values()].sort(
            (a, b) => this.peerScorer.getScore(b.stats) - this.peerScorer.getScore(a.stats),
        );
        for (const state of states) {
            if (state !== last) this.pumpPeer(state);
        }
        if (last) this.pumpPeer(last);
    }

    private recordReceivedBlock(
        state: PeerDownloadState,
        pending: PendingPeerRequest,
        message: Extract<PeerMessage, { type: 'piece' }>,
    ): void {
        const now = Date.now();

        state.stats.receivedBytes += message.block.byteLength;
        state.stats.receivedBlocks += 1;
        state.stats.completedRequests += 1;
        state.stats.totalRequestTimeMs += Math.max(0, now - pending.requestedAt);
        state.stats.lastBlockAt = now;
    }

    private clearPendingTimeouts(pending: PendingPeerRequest[]): void {
        for (const request of pending) clearTimeout(request.timeout);
    }

    private emitProgress(): void {
        this.updateSpeed();
        const progress = this.progress;
        for (const listener of this.progressListeners) listener(progress);
    }

    private updateSpeed(): void {
        const now = Date.now();
        const receivedBytes = this.getReceivedBytes();
        const last = this.lastProgressSample;

        if (last) {
            const elapsedMs = now - last.timestampMs;
            if (elapsedMs < this.speedSampleIntervalMs) return;

            const elapsedSeconds = elapsedMs / 1_000;
            const receivedDelta = receivedBytes - last.receivedBytes;
            this.currentSpeedBytesPerSecond =
                elapsedSeconds > 0 ? Math.max(0, receivedDelta / elapsedSeconds) : 0;
        }

        this.lastProgressSample = { receivedBytes, timestampMs: now };
    }

    private getReceivedBytes(): number {
        let receivedBytes = 0;

        for (const pieceIndex of this.planner.pieceIndexes) {
            receivedBytes += this.planner.getProgress(pieceIndex).receivedBytes;
        }

        return receivedBytes;
    }

    private resolveIfComplete(): void {
        if (this.planner.complete) {
            this.resolveDone();
        }
    }
}

const isSameRequest = (a: PieceBlockRequest, b: PieceBlockRequest): boolean =>
    a.pieceIndex === b.pieceIndex && a.offset === b.offset && a.length === b.length;

const createInitialPeerStats = (): PeerDownloadStats => ({
    receivedBytes: 0,
    receivedBlocks: 0,
    timedOutRequests: 0,
    sentRequests: 0,
    completedPieces: 0,
    invalidPieces: 0,
    lastBlockAt: null,
    totalRequestTimeMs: 0,
    completedRequests: 0,
});
