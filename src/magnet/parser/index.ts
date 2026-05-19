import { defaults } from '../../configs/defaults';
import { fetchMetadataFromPeer } from '../../peer/extended';
import { type TorrentMetadata } from '../../torrent';
import { trackPeers } from '../../tracker';
import { decodeBase32 } from '../base32';
import { MagnetParseError, MagnetParseErrorCode } from './errors';
import { parseInfoDict } from './meta';
import type { ParsedMagnetURI } from './types';

export const parseMagnet = async (
    magnet: string,
    peerId: Uint8Array,
    options?: { timeout?: number },
): Promise<TorrentMetadata> => {
    const data = parseMagnetURI(magnet);

    if (data.trackers.length <= 0) {
        throw new MagnetParseError(
            MagnetParseErrorCode.NOT_IMPLEMENTED,
            'No trackers found, DHT is not yet implemented',
        );
    }

    const peers = await trackPeers({
        meta: {
            infoHash: data.infoHash,
            length: 0,
            announce: undefined,
            announceList: data.trackers.map((t) => [t]),
        },
        peerId: peerId,
        timeoutMs: defaults.magnet.trackerTimeoutMs,
    });

    let raw;
    try {
        raw = await Promise.any(
            peers.map((p) =>
                fetchMetadataFromPeer(p, data.infoHash, peerId, {
                    timeoutMs: options?.timeout ?? defaults.magnet.peerTimeoutMs,
                }),
            ),
        );
    } catch {
        throw new MagnetParseError(
            MagnetParseErrorCode.NO_METADATA,
            'Failed to fetch metadata from any peer',
        );
    }

    try {
        return parseInfoDict(
            raw,
            data.infoHash,
            undefined,
            data.trackers.map((t) => [t]),
        );
    } catch {
        throw new MagnetParseError(
            MagnetParseErrorCode.PARSING_FAILED,
            'Failed to parse metadata from peer',
        );
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
