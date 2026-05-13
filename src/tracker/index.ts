import type { TorrentMetadata } from '@torrent/types';
import { announceUdp } from './announce';

export const trackPeers = async ({
    meta,
    peerId,
}: {
    meta: TorrentMetadata;
    peerId: Uint8Array;
}) => {
    const trackers = [meta.announce, ...meta.announceList.flat()].filter(Boolean) as string[];

    const udpTrackers = trackers.filter((t) => t.startsWith('udp://'));

    return await Promise.any(udpTrackers.map((t) => announceUdp(t, meta, peerId))).catch(() => []);
};
