import type { TorrentMetadata } from '../torrent/types';
import { announceHttp } from './http';
import { type AnnounceTracker, type PeerInfo } from './types';
import { announceUdp } from './udp';
import { TrackerError, TrackerErrorCode } from './tracker.error';
import { defaults } from '../configs/defaults';

export const trackPeers = async ({
    meta,
    peerId,
    announcePort = defaults.trackers.announcePort,
    timeoutMs = defaults.trackers.timeoutMs,
    udp = announceUdp,
    http = announceHttp,
}: {
    meta: TorrentMetadata;
    peerId: Uint8Array;
    announcePort?: number;
    timeoutMs?: number;
    udp?: AnnounceTracker;
    http?: AnnounceTracker;
}): Promise<PeerInfo[]> => {
    validateAnnouncePort(announcePort);

    const trackers = [meta.announce, ...meta.announceList.flat()].filter(Boolean) as string[];
    const announceRequests = trackers.flatMap((tracker) => {
        if (tracker.startsWith('udp://')) return [{ tracker, announce: udp }];
        if (tracker.startsWith('http://') || tracker.startsWith('https://')) {
            return [{ tracker, announce: http }];
        }
        return [];
    });

    if (announceRequests.length === 0) {
        throw new TrackerError(
            TrackerErrorCode.NO_SUPPORTED_TRACKERS,
            'No supported trackers found',
        );
    }

    const results = await Promise.allSettled(
        announceRequests.map(({ tracker, announce }) =>
            announce(tracker, meta, peerId, { announcePort, timeoutMs }),
        ),
    );

    const peers = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    const dedupedPeers = dedupePeers(peers);

    if (dedupedPeers.length > 0) {
        return dedupedPeers;
    }

    const causes = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
    );

    if (causes.every(isTrackerNoPeersError)) {
        throw new TrackerError(TrackerErrorCode.NO_PEERS, 'Trackers returned no peers', causes);
    }

    throw new TrackerError(
        TrackerErrorCode.ANNOUNCE_FAILED,
        'All tracker announces failed',
        causes,
    );
};

const dedupePeers = (peers: PeerInfo[]) => {
    const included = new Set();
    return peers.filter((p) => {
        const key = p.ip + ':' + p.port;
        if (included.has(key)) return false;
        included.add(key);
        return true;
    });
};

const isTrackerNoPeersError = (error: unknown): error is TrackerError =>
    error instanceof TrackerError && error.code === TrackerErrorCode.NO_PEERS;

const validateAnnouncePort = (port: number): void => {
    if (Number.isInteger(port) && port >= 1 && port <= 65_535) return;

    throw new TrackerError(
        TrackerErrorCode.INVALID_PORT,
        'Announce port must be an integer between 1 and 65535',
    );
};

export { TrackerError, TrackerErrorCode } from './tracker.error';
export type { PeerInfo } from './types';
