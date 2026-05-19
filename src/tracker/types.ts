import type { TorrentMetadata } from '../torrent/types';

export type PeerInfo = { ip: string; port: number };

export type AnnounceOptions = {
    announcePort?: number;
    timeoutMs?: number;
};

export type AnnounceTracker = (
    tracker: string,
    meta: Pick<TorrentMetadata, 'infoHash' | 'length'>,
    peerId: Uint8Array,
    options?: AnnounceOptions,
) => Promise<PeerInfo[]>;
