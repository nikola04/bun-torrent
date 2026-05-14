import type { TorrentMetadata } from '@torrent/types';
import { announceUdp, type PeerInfo } from './announce';

const DEFAULT_TRACKER_TIMEOUT_MS = 3_000;

export const trackPeers = async ({
    meta,
    peerId,
    timeoutMs = DEFAULT_TRACKER_TIMEOUT_MS,
}: {
    meta: TorrentMetadata;
    peerId: Uint8Array;
    timeoutMs?: number;
}): Promise<PeerInfo[]> => {
    const trackers = [meta.announce, ...meta.announceList.flat()].filter(Boolean) as string[];

    const udpTrackers = trackers.filter((t) => t.startsWith('udp://'));

    const results = await Promise.allSettled(
        udpTrackers.map((tracker) =>
            announceUdp(tracker, meta, peerId, { timeoutMs }).catch(() => []),
        ),
    );

    const peers = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    return dedupePeers(peers);
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
