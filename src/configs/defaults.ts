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
    download: {
        maxInFlightRequestsPerPeer: 300,
        baseInFlightRequestsPerPeer: 8,
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
    dht: {
        bootstrapNodes: [
            { host: 'router.bittorrent.com', port: 6881 },
            { host: 'router.utorrent.com', port: 6881 },
            { host: 'dht.transmissionbt.com', port: 6881 },
        ],
        lookupConcurrency: 8,
        maxLookupRounds: 8,
        peerCacheTtlMs: 5 * 60_000,
        queryTimeoutMs: 5_000,
    },
    magnet: {
        trackerTimeoutMs: 3_000,
        peerTimeoutMs: 5_000,
    },
} as const;
