import { defaults } from '../../configs/defaults';
import { fetchMetadataFromPeer as defaultFetchMetadataFromPeer } from '../../peer/extended';
import { type TorrentMetadata } from '../../torrent';
import { trackPeers } from '../../tracker';
import type { PeerInfo } from '../../tracker/types';
import { decodeBase32 } from '../base32';
import { MagnetParseError, MagnetParseErrorCode } from './errors';
import { parseInfoDict } from './meta';
import type { ParsedMagnetURI } from './types';

export type MagnetPeerDiscovery = {
    lookupPeers(infoHash: Uint8Array): Promise<PeerInfo[]>;
};

export type ParseMagnetOptions = {
    timeout?: number;
    dht?: MagnetPeerDiscovery;
    fetchMetadataFromPeer?: typeof defaultFetchMetadataFromPeer;
};

export const parseMagnet = async (
    magnet: string,
    peerId: Uint8Array,
    options: ParseMagnetOptions = {},
): Promise<TorrentMetadata> => {
    const data = parseMagnetURI(magnet);

    if (data.trackers.length <= 0 && !options.dht) {
        throw new MagnetParseError(
            MagnetParseErrorCode.NOT_IMPLEMENTED,
            'No trackers found, DHT is not yet implemented',
        );
    }

    let peers: PeerInfo[];
    try {
        peers = await discoverMagnetPeers(data, peerId, options);
    } catch (error) {
        throw new MagnetParseError(
            MagnetParseErrorCode.NO_METADATA,
            'Failed to discover peers for magnet metadata',
            undefined,
            error,
        );
    }

    if (peers.length === 0) {
        throw new MagnetParseError(
            MagnetParseErrorCode.NO_METADATA,
            'No peers found for magnet metadata',
        );
    }

    let result: { raw: unknown; peer: PeerInfo };
    const controller = new AbortController();
    const timeoutMs = options?.timeout ?? defaults.magnet.peerTimeoutMs;
    const fetchMetadataFromPeer = options.fetchMetadataFromPeer ?? defaultFetchMetadataFromPeer;
    try {
        result = await Promise.any(
            peers.map((p) =>
                fetchMetadataFromPeer(p, data.infoHash, peerId, {
                    timeoutMs,
                    signal: controller.signal,
                }).then((raw) => ({ raw, peer: p })),
            ),
        );
        controller.abort();
    } catch (error) {
        controller.abort();
        throw new MagnetParseError(
            MagnetParseErrorCode.NO_METADATA,
            `Failed to fetch metadata from ${peers.length} peer(s)`,
            undefined,
            error,
        );
    }

    try {
        return parseInfoDict(
            result.raw,
            data.infoHash,
            undefined,
            data.trackers.map((t) => [t]),
        );
    } catch (error) {
        throw new MagnetParseError(
            MagnetParseErrorCode.PARSING_FAILED,
            'Failed to parse metadata from peer',
            undefined,
            error,
        );
    }
};

const discoverMagnetPeers = async (
    data: ParsedMagnetURI,
    peerId: Uint8Array,
    options: ParseMagnetOptions,
): Promise<PeerInfo[]> => {
    const peers = data.trackers.length > 0 ? await discoverTrackerPeers(data, peerId, options) : [];
    if (peers.length > 0) return peers;

    return (await options.dht?.lookupPeers(data.infoHash)) ?? [];
};

const discoverTrackerPeers = async (
    data: ParsedMagnetURI,
    peerId: Uint8Array,
    options: ParseMagnetOptions,
): Promise<PeerInfo[]> => {
    try {
        return await trackPeers({
            meta: {
                infoHash: data.infoHash,
                length: 0,
                announce: undefined,
                announceList: data.trackers.map((t) => [t]),
            },
            peerId,
            timeoutMs: defaults.magnet.trackerTimeoutMs,
        });
    } catch (error) {
        if (options.dht) return [];
        throw error;
    }
};

export const parseMagnetURI = (uri: string): ParsedMagnetURI => {
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        throw new MagnetParseError(MagnetParseErrorCode.INVALID_URI, 'Invalid magnet URI');
    }

    if (url.protocol !== 'magnet:') {
        throw new MagnetParseError(MagnetParseErrorCode.INVALID_URI, 'Invalid magnet URI scheme');
    }

    const params = new URLSearchParams(url.search);

    const xt = params.get('xt');
    const name = params.get('dn') ?? undefined;
    const trackers = params.getAll('tr');

    if (!xt?.startsWith('urn:btih:'))
        throw new MagnetParseError(MagnetParseErrorCode.INVALID_XT, 'Invalid xt parameter');

    const raw = xt.slice(9);

    if (raw.length !== 40 && raw.length !== 32) {
        throw new MagnetParseError(MagnetParseErrorCode.INVALID_XT, 'Invalid info hash length');
    }

    if (raw.length === 40 && !isHex(raw)) {
        throw new MagnetParseError(MagnetParseErrorCode.INVALID_XT, 'Invalid hex info hash');
    }

    return {
        infoHash: raw.length === 40 ? Uint8Array.fromHex(raw) : decodeBase32(raw),
        name,
        trackers,
    };
};

const isHex = (str: string) => {
    const hexRegex = /^[0-9a-fA-F]+$/;
    return hexRegex.test(str) && str.length === 40;
};

export { MagnetParseError, MagnetParseErrorCode };
