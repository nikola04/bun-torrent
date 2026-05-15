import type { TorrentMetadata } from '@torrent/types';

export type PeerInfo = { ip: string; port: number };

export const DEFAULT_ANNOUNCE_PORT = 6881;

export type AnnounceOptions = {
    announcePort?: number;
    timeoutMs?: number;
};

export type AnnounceTracker = (
    tracker: string,
    meta: TorrentMetadata,
    peerId: Uint8Array,
    options?: AnnounceOptions,
) => Promise<PeerInfo[]>;
