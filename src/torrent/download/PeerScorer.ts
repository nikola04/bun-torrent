export type PeerDownloadStats = {
    receivedBytes: number;
    receivedBlocks: number;
    timedOutRequests: number;
    sentRequests: number;
    completedPieces: number;
    invalidPieces: number;
    lastBlockAt: number | null;
    totalRequestTimeMs: number;
    completedRequests: number;
};

export class PeerScorer {
    public getScore(stats: PeerDownloadStats): number {
        const averageRequestTime =
            stats.completedRequests === 0
                ? Number.POSITIVE_INFINITY
                : stats.totalRequestTimeMs / stats.completedRequests;

        const timeoutPenalty = stats.timedOutRequests * 1000;
        const invalidPenalty = stats.invalidPieces * 2000;
        const speedBonus = stats.receivedBytes / Math.max(1, averageRequestTime);

        return speedBonus + stats.completedPieces * 100 - timeoutPenalty - invalidPenalty;
    }

    public getRequestLimit(stats: PeerDownloadStats, defaultLimit: number): number {
        if (stats.timedOutRequests >= 5 && stats.completedRequests === 0) return 1;
        if (stats.completedRequests < 5) return defaultLimit;

        const timeoutRate = stats.timedOutRequests / stats.sentRequests;

        if (timeoutRate > 0.5) return Math.max(1, Math.floor(defaultLimit / 4));
        if (timeoutRate > 0.25) return Math.max(1, Math.floor(defaultLimit / 2));

        return defaultLimit;
    }
}
