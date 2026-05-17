export const defaults = {
    pieces: {
        blockSize: 16 * 1024,
    },
    peers: {
        targetConnections: 20,
        minConnections: 0,
        maxConnecting: 30,
        connectTimeoutMs: 5_000,
    },
    peerPool: {
        minConnections: 1,
        maxConnecting: 20,
        connectTimeoutMs: 3_000,
    },
    download: {
        maxInFlightRequestsPerPeer: 20,
        requestTimeoutMs: 15_000,
        seed: false,
    },
    progress: {
        events: 'piece',
        speedSampleIntervalMs: 500,
    },
    trackers: {
        announcePort: 6881,
        timeoutMs: 5_000,
    },
} as const;
