import { decodeBencode, type BValue } from '../torrent/bencode';
import type { TorrentMetadata } from '../torrent/types';
import { type AnnounceOptions, type PeerInfo } from './types';
import { TrackerError, TrackerErrorCode } from './tracker.error';
import { defaults } from '../configs/defaults';

const textDecoder = new TextDecoder();

export const announceHttp = async (
    tracker: string,
    meta: Pick<TorrentMetadata, 'infoHash' | 'length'>,
    peerId: Uint8Array,
    options: AnnounceOptions = {},
): Promise<PeerInfo[]> => {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? defaults.trackers.timeoutMs,
    );

    let response: Response;
    try {
        response = await fetch(buildHttpAnnounceUrl(tracker, meta, peerId, options), {
            signal: controller.signal,
        });
    } catch (error) {
        const code = controller.signal.aborted
            ? TrackerErrorCode.ANNOUNCE_TIMEOUT
            : TrackerErrorCode.HTTP_REQUEST_FAILED;
        const message = controller.signal.aborted
            ? 'HTTP tracker announce timeout'
            : 'HTTP tracker request failed';

        throw new TrackerError(code, message, [error]);
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        throw new TrackerError(
            TrackerErrorCode.HTTP_REQUEST_FAILED,
            `HTTP tracker request failed with status ${response.status}`,
        );
    }

    return parseHttpAnnounceResponse(new Uint8Array(await response.arrayBuffer()));
};

export const parseHttpAnnounceResponse = (data: Uint8Array): PeerInfo[] => {
    let response: BValue;
    try {
        response = decodeBencode(data);
    } catch (error) {
        throw new TrackerError(
            TrackerErrorCode.HTTP_RESPONSE_INVALID,
            'HTTP tracker response must be bencoded',
            [error],
        );
    }

    if (!(response instanceof Map)) {
        throw new TrackerError(
            TrackerErrorCode.HTTP_RESPONSE_INVALID,
            'HTTP tracker response must be a dictionary',
        );
    }

    const failureReason = response.get('failure reason');
    if (failureReason instanceof Uint8Array) {
        throw new TrackerError(
            TrackerErrorCode.FAILURE_RESPONSE,
            `HTTP tracker failure response: ${textDecoder.decode(failureReason)}`,
        );
    }

    const peersValue = response.get('peers');
    if (!(peersValue instanceof Uint8Array)) {
        throw new TrackerError(
            TrackerErrorCode.HTTP_RESPONSE_INVALID,
            'HTTP tracker response must include compact peers',
        );
    }

    const peers = parseCompactPeers(peersValue);
    if (peers.length === 0) {
        throw new TrackerError(TrackerErrorCode.NO_PEERS, 'HTTP tracker returned no peers');
    }

    return peers;
};

const buildHttpAnnounceUrl = (
    tracker: string,
    meta: Pick<TorrentMetadata, 'infoHash' | 'length'>,
    peerId: Uint8Array,
    options: AnnounceOptions,
): string => {
    const url = new URL(tracker);
    url.hash = '';

    const params = [
        `info_hash=${percentEncodeBytes(meta.infoHash)}`,
        `peer_id=${percentEncodeBytes(peerId)}`,
        `port=${options.announcePort ?? defaults.trackers.announcePort}`,
        'uploaded=0',
        'downloaded=0',
        `left=${meta.length}`,
        'compact=1',
        'event=started',
    ];

    return `${url.toString()}${url.search ? '&' : '?'}${params.join('&')}`;
};

const parseCompactPeers = (data: Uint8Array): PeerInfo[] => {
    if (data.byteLength % 6 !== 0) {
        throw new TrackerError(
            TrackerErrorCode.HTTP_RESPONSE_INVALID,
            'Compact peer list must be made of 6-byte peers',
        );
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const peers: PeerInfo[] = [];

    for (let offset = 0; offset < data.byteLength; offset += 6) {
        peers.push({
            ip: `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`,
            port: view.getUint16(offset + 4, false),
        });
    }

    return peers;
};

const percentEncodeBytes = (bytes: Uint8Array): string =>
    [...bytes].map((byte) => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`).join('');
