import type { TorrentMetadata } from '@torrent/types';
import { lookup } from 'dns/promises';
import { DEFAULT_ANNOUNCE_PORT, type AnnounceOptions, type PeerInfo } from './types';
import { TrackerError, TrackerErrorCode } from './tracker.error';

export const announceUdp = async (
    tracker: string,
    meta: TorrentMetadata,
    peerId: Uint8Array,
    options: AnnounceOptions = {},
): Promise<PeerInfo[]> => {
    const url = new URL(tracker);
    const { address: host } = await lookup(url.hostname);

    const trackerPort = parseInt(url.port, 10);
    const timeoutMs = options.timeoutMs ?? 1_000;
    const announcePort = options.announcePort ?? DEFAULT_ANNOUNCE_PORT;

    let phase: 'connect' | 'announce' = 'connect';
    const connectTxId = randomU32();
    let announceTxId = 0;
    let connHigh = 0;
    let connLow = 0;

    let resolveFn!: (peers: PeerInfo[]) => void;
    let rejectFn!: (err: unknown) => void;
    let settled = false;

    const promise = new Promise<PeerInfo[]>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
    });

    const clearAnnounceTimeout = () => clearTimeout(timeout);

    const resolveOnce = (peers: PeerInfo[]) => {
        if (settled) return;
        settled = true;
        clearAnnounceTimeout();
        resolveFn(peers);
    };

    const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearAnnounceTimeout();
        rejectFn(error);
    };

    const socket = await Bun.udpSocket({
        socket: {
            data(socket, data) {
                try {
                    const bytes = new Uint8Array(data);

                    if (phase === 'connect') {
                        ({ connHigh, connLow } = parseConnectResponse(bytes, connectTxId));

                        announceTxId = randomU32();
                        phase = 'announce';

                        socket.send(
                            buildAnnounceRequest(
                                connHigh,
                                connLow,
                                announceTxId,
                                meta,
                                peerId,
                                announcePort,
                            ),
                            trackerPort,
                            host,
                        );

                        return;
                    }

                    const peers = parseAnnounceResponse(bytes, announceTxId);
                    socket.close();
                    if (peers.length === 0) {
                        rejectOnce(
                            new TrackerError(
                                TrackerErrorCode.NO_PEERS,
                                'Tracker returned no peers',
                            ),
                        );
                        return;
                    }
                    resolveOnce(peers);
                } catch (err) {
                    socket.close();
                    rejectOnce(err);
                }
            },

            error(socket, err) {
                socket.close();
                rejectOnce(err);
            },
        },
    });

    const timeout = setTimeout(() => {
        socket.close();
        rejectOnce(new TrackerError(TrackerErrorCode.ANNOUNCE_TIMEOUT, 'Tracker announce timeout'));
    }, timeoutMs);

    socket.send(buildConnectRequest(connectTxId), trackerPort, host);

    return promise;
};

const MAGIC_HIGH = 0x00000417;
const MAGIC_LOW = 0x27101980;

const randomU32 = (): number => (Math.random() * 0xffffffff) >>> 0;

const buildConnectRequest = (txId: number): Uint8Array => {
    const buf = new Uint8Array(16);
    const view = new DataView(buf.buffer);
    view.setUint32(0, MAGIC_HIGH, false);
    view.setUint32(4, MAGIC_LOW, false);
    view.setUint32(8, 0, false); // action = connect
    view.setUint32(12, txId, false);
    return buf;
};

const parseConnectResponse = (data: Uint8Array, txId: number) => {
    if (data.byteLength < 16) {
        throw new TrackerError(
            TrackerErrorCode.CONNECT_RESPONSE_TOO_SHORT,
            'Connect response too short',
        );
    }
    const view = new DataView(data.buffer, data.byteOffset);
    if (view.getUint32(0, false) !== 0) {
        throw new TrackerError(TrackerErrorCode.INVALID_ACTION, 'Expected tracker action=0');
    }
    if (view.getUint32(4, false) !== txId) {
        throw new TrackerError(
            TrackerErrorCode.TRANSACTION_ID_MISMATCH,
            'Tracker transaction ID mismatch',
        );
    }
    return {
        connHigh: view.getUint32(8, false),
        connLow: view.getUint32(12, false),
    };
};

const buildAnnounceRequest = (
    connHigh: number,
    connLow: number,
    txId: number,
    meta: TorrentMetadata,
    peerId: Uint8Array,
    announcePort: number,
): Uint8Array => {
    const buf = new Uint8Array(98);
    const view = new DataView(buf.buffer);
    let o = 0;

    view.setUint32(o, connHigh, false);
    o += 4;
    view.setUint32(o, connLow, false);
    o += 4;
    view.setUint32(o, 1, false);
    o += 4; // action = announce
    view.setUint32(o, txId, false);
    o += 4;

    buf.set(meta.infoHash, o);
    o += 20;
    buf.set(peerId, o);
    o += 20;

    // downloaded = 0
    view.setUint32(o, 0, false);
    o += 4;
    view.setUint32(o, 0, false);
    o += 4;

    // left = meta.length
    const left = BigInt(meta.length);
    view.setUint32(o, Number(left >> 32n), false);
    o += 4;
    view.setUint32(o, Number(left & 0xffffffffn), false);
    o += 4;

    // uploaded = 0
    view.setUint32(o, 0, false);
    o += 4;
    view.setUint32(o, 0, false);
    o += 4;

    view.setUint32(o, 2, false);
    o += 4; // event = started
    view.setUint32(o, 0, false);
    o += 4; // ip = default
    view.setUint32(o, randomU32(), false);
    o += 4; // key
    view.setInt32(o, -1, false);
    o += 4; // num_want = -1 (default)
    view.setUint16(o, announcePort, false); // client listen port

    return buf;
};

const parseAnnounceResponse = (data: Uint8Array, txId: number): PeerInfo[] => {
    if (data.byteLength < 20) {
        throw new TrackerError(
            TrackerErrorCode.ANNOUNCE_RESPONSE_TOO_SHORT,
            'Announce response too short',
        );
    }
    const view = new DataView(data.buffer, data.byteOffset);
    if (view.getUint32(0, false) !== 1) {
        throw new TrackerError(TrackerErrorCode.INVALID_ACTION, 'Expected tracker action=1');
    }
    if (view.getUint32(4, false) !== txId) {
        throw new TrackerError(
            TrackerErrorCode.TRANSACTION_ID_MISMATCH,
            'Tracker transaction ID mismatch',
        );
    }

    const peers: PeerInfo[] = [];
    for (let o = 20; o + 6 <= data.byteLength; o += 6) {
        const ip = `${data[o]}.${data[o + 1]}.${data[o + 2]}.${data[o + 3]}`;
        const port = view.getUint16(o + 4, false);
        peers.push({ ip, port });
    }
    return peers;
};
