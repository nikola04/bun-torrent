import { DHTError, DHTErrorCode } from '../errors';
import { DHT_ID_LENGTH, isDhtId } from './distance';

export const COMPACT_IPV4_PEER_LENGTH = 6;
export const COMPACT_IPV4_NODE_LENGTH = 26;

export type DhtNode = {
    id: Uint8Array;
    host: string;
    port: number;
};

export type DhtPeer = {
    host: string;
    port: number;
};

export const decodeCompactPeer = (bytes: Uint8Array): DhtPeer => {
    if (bytes.byteLength !== COMPACT_IPV4_PEER_LENGTH) {
        throw new DHTError(
            DHTErrorCode.INVALID_COMPACT_PEER,
            `Compact peer must be exactly ${COMPACT_IPV4_PEER_LENGTH} bytes`,
        );
    }

    const host = `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
    const port = (bytes[4]! << 8) | bytes[5]!;

    return { host, port } satisfies DhtPeer;
};

export const decodeCompactPeers = (bytes: Uint8Array): DhtPeer[] => {
    if (bytes.byteLength % COMPACT_IPV4_PEER_LENGTH !== 0) {
        throw new DHTError(
            DHTErrorCode.INVALID_COMPACT_PEER,
            `Compact peers length must be divisible by ${COMPACT_IPV4_PEER_LENGTH} bytes`,
        );
    }

    const peers: DhtPeer[] = [];

    for (let offset = 0; offset < bytes.byteLength; offset += COMPACT_IPV4_PEER_LENGTH) {
        peers.push(decodeCompactPeer(bytes.subarray(offset, offset + COMPACT_IPV4_PEER_LENGTH)));
    }

    return peers;
};

export const encodeCompactPeer = (peer: DhtPeer): Uint8Array => {
    const bytes = new Uint8Array(COMPACT_IPV4_PEER_LENGTH);
    bytes.set(encodeIPv4Host(peer.host), 0);
    writePort(bytes, 4, peer.port);
    return bytes;
};

export const decodeCompactNode = (bytes: Uint8Array): DhtNode => {
    if (bytes.byteLength !== COMPACT_IPV4_NODE_LENGTH) {
        throw new DHTError(
            DHTErrorCode.INVALID_COMPACT_NODE,
            `Compact node must be exactly ${COMPACT_IPV4_NODE_LENGTH} bytes`,
        );
    }

    const id = bytes.slice(0, DHT_ID_LENGTH);
    const host = `${bytes[20]}.${bytes[21]}.${bytes[22]}.${bytes[23]}`;
    const port = (bytes[24]! << 8) | bytes[25]!;

    return { id, host, port } satisfies DhtNode;
};

export const decodeCompactNodes = (bytes: Uint8Array): DhtNode[] => {
    if (bytes.byteLength % COMPACT_IPV4_NODE_LENGTH !== 0) {
        throw new DHTError(
            DHTErrorCode.INVALID_COMPACT_NODE,
            `Compact nodes length must be divisible by ${COMPACT_IPV4_NODE_LENGTH} bytes`,
        );
    }

    const nodes: DhtNode[] = [];

    for (let offset = 0; offset < bytes.byteLength; offset += COMPACT_IPV4_NODE_LENGTH) {
        nodes.push(decodeCompactNode(bytes.subarray(offset, offset + COMPACT_IPV4_NODE_LENGTH)));
    }

    return nodes;
};

export const encodeCompactNode = (node: DhtNode): Uint8Array => {
    if (!isDhtId(node.id)) {
        throw new DHTError(
            DHTErrorCode.INVALID_DHT_ID,
            `DHT node id must be exactly ${DHT_ID_LENGTH} bytes`,
        );
    }

    const bytes = new Uint8Array(COMPACT_IPV4_NODE_LENGTH);
    bytes.set(node.id, 0);
    bytes.set(encodeIPv4Host(node.host), 20);
    writePort(bytes, 24, node.port);
    return bytes;
};

const encodeIPv4Host = (host: string): Uint8Array => {
    const parts = host.split('.');

    if (parts.length !== 4) {
        throw new DHTError(DHTErrorCode.INVALID_IPV4_HOST, `Invalid IPv4 host: ${host}`);
    }

    return Uint8Array.from(
        parts.map((part) => {
            if (!/^\d+$/.test(part)) {
                throw new DHTError(DHTErrorCode.INVALID_IPV4_HOST, `Invalid IPv4 host: ${host}`);
            }

            const value = Number(part);
            if (!Number.isInteger(value) || value < 0 || value > 255) {
                throw new DHTError(DHTErrorCode.INVALID_IPV4_HOST, `Invalid IPv4 host: ${host}`);
            }

            return value;
        }),
    );
};

const writePort = (bytes: Uint8Array, offset: number, port: number): void => {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new DHTError(DHTErrorCode.INVALID_PORT, `Invalid port: ${port}`);
    }

    bytes[offset] = port >> 8;
    bytes[offset + 1] = port & 0xff;
};
