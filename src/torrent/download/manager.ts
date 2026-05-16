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

export type DownloadProgressEventMode = 'piece' | 'block';

export type DownloadProgress = {
    totalBytes: number;
    receivedBytes: number;
    downloadedBytes: number;
    totalPieces: number;
    completedPieces: number;
    percent: number;
    speedBytesPerSecond: number;
    speed: string;
};

export type DownloadProgressListener = (progress: DownloadProgress) => void;

type PeerDownloadState = {
    peer: PeerSession;
    pending: PendingPeerRequest[];
    interestedSent: boolean;
    stats: PeerDownloadStats;
    offClose: () => void;
    offMessage: () => void;
};

type PendingPeerRequest = {
    request: PieceBlockRequest;
    timeout: ReturnType<typeof setTimeout>;
    requestedAt: number;
};

const DEFAULT_MAX_IN_FLIGHT_REQUESTS_PER_PEER = 20;
const DEFAULT_PROGRESS_EVENTS: DownloadProgressEventMode = 'piece';
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_SPEED_SAMPLE_INTERVAL_MS = 500;

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
            options.maxInFlightRequestsPerPeer ?? DEFAULT_MAX_IN_FLIGHT_REQUESTS_PER_PEER;
        this.progressEvents = options.progressEvents ?? DEFAULT_PROGRESS_EVENTS;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.speedSampleIntervalMs =
            options.speedSampleIntervalMs ?? DEFAULT_SPEED_SAMPLE_INTERVAL_MS;
        this.writeValidated = options.writeValidatedPiece ?? writeValidatedPiece;
        this.done = new Promise((resolve, reject) => {
            this.resolveDone = resolve;
            this.rejectDone = reject;
        });
    }

    public get progress(): DownloadProgress {
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
            percent: totalBytes === 0 ? 1 : downloadedBytes / totalBytes,
            speedBytesPerSecond: this.currentSpeedBytesPerSecond,
            speed: `${formatBytes(this.currentSpeedBytesPerSecond)}ps`,
        };
    }

    public start(): void {
        if (this.closed || this.offSession) return;

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
            stats: {
                receivedBytes: 0,
                receivedBlocks: 0,
                timedOutRequests: 0,
                sentRequests: 0,
                completedPieces: 0,
                invalidPieces: 0,
                lastBlockAt: null,
                totalRequestTimeMs: 0,
                completedRequests: 0,
            },
            offClose: peer.onClose(() => this.handlePeerClosed(peer)),
            offMessage: peer.onMessage((message) => this.handlePeerMessage(peer, message)),
        };

        this.peerStates.set(peer, state);
        this.pumpPeer(state);
    }

    private detachPeer(state: PeerDownloadState): void {
        state.offClose();
        state.offMessage();
        this.clearPendingTimeouts(state.pending);
        this.planner.resetPeerRequests(state.pending.map((pending) => pending.request));
        state.pending = [];
    }

    private handlePeerClosed(peer: PeerSession): void {
        const state = this.peerStates.get(peer);
        if (!state) return;

        this.detachPeer(state);
        this.peerStates.delete(peer);
    }

    private handlePeerMessage(peer: PeerSession, message: PeerMessage): void {
        const state = this.peerStates.get(peer);
        if (!state || this.closed) return;

        if (message.type === 'unchoke' || message.type === 'have' || message.type === 'bitfield') {
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
        const pendingIndex = state.pending.findIndex(
            ({ request }) =>
                request.pieceIndex === message.pieceIndex &&
                request.offset === message.offset &&
                request.length === message.block.byteLength,
        );
        if (pendingIndex === -1) return;

        const [pending] = state.pending.splice(pendingIndex, 1);
        if (pending) clearTimeout(pending.timeout);
        if (pending) this.recordReceivedBlock(state, pending, message);

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
        if (this.planner.complete) return;

        this.sendInterestedIfUseful(state);
        if (state.peer.choked) return;

        const requestLimit = this.peerScorer.getRequestLimit(
            state.stats,
            this.maxInFlightRequestsPerPeer,
        );

        while (state.pending.length < requestLimit) {
            const request = this.planner.nextRequest(state.peer.peerAvailability);
            if (!request) break;

            this.planner.markPending(request);
            const timeout = setTimeout(
                () => this.handleRequestTimeout(state, request),
                this.requestTimeoutMs,
            );
            unrefTimer(timeout);
            state.pending.push({
                request,
                timeout,
                requestedAt: Date.now(),
            });
            state.stats.sentRequests += 1;
            state.peer.sendMessage(request);
        }
    }

    private handleRequestTimeout(state: PeerDownloadState, request: PieceBlockRequest): void {
        if (this.closed || this.planner.complete) return;

        const pendingIndex = state.pending.findIndex((pending) =>
            isSameRequest(pending.request, request),
        );
        if (pendingIndex === -1) return;

        const [pending] = state.pending.splice(pendingIndex, 1);
        if (pending) clearTimeout(pending.timeout);

        state.stats.timedOutRequests += 1;
        this.planner.resetPending(request);
        this.pumpPeers(state);
    }

    private sendInterestedIfUseful(state: PeerDownloadState): void {
        if (state.interestedSent) return;
        if (!this.planner.nextRequest(state.peer.peerAvailability)) return;

        state.peer.sendMessage({ type: 'interested' });
        state.interestedSent = true;
    }

    private resetPieceForRetry(pieceIndex: number): void {
        this.planner.resetPiece(pieceIndex);

        for (const state of this.peerStates.values()) {
            const kept: PendingPeerRequest[] = [];
            for (const pending of state.pending) {
                if (pending.request.pieceIndex === pieceIndex) {
                    clearTimeout(pending.timeout);
                } else {
                    kept.push(pending);
                }
            }
            state.pending = kept;
        }
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

const unrefTimer = (timer: ReturnType<typeof setTimeout>): void => {
    if (typeof timer === 'object' && timer && 'unref' in timer) {
        (timer as { unref: () => void }).unref();
    }
};
