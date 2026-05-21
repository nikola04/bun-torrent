import { describe, expect, it } from 'bun:test';

import { DHTError, DHTErrorCode } from '../errors';
import {
    decodeCompactNode,
    decodeCompactNodes,
    decodeCompactPeer,
    decodeCompactPeers,
    encodeCompactNode,
    encodeCompactPeer,
} from './compact';

describe('compact DHT peers', () => {
    it('decodes compact IPv4 peer info', () => {
        expect(decodeCompactPeer(new Uint8Array([127, 0, 0, 1, 0x1a, 0xe1]))).toEqual({
            host: '127.0.0.1',
            port: 6881,
        });
    });

    it('decodes concatenated compact IPv4 peer info', () => {
        expect(
            decodeCompactPeers(new Uint8Array([127, 0, 0, 1, 0x1a, 0xe1, 10, 0, 0, 2, 0, 80])),
        ).toEqual([
            { host: '127.0.0.1', port: 6881 },
            { host: '10.0.0.2', port: 80 },
        ]);
    });

    it('encodes compact IPv4 peer info', () => {
        expect([...encodeCompactPeer({ host: '127.0.0.1', port: 6881 })]).toEqual([
            127, 0, 0, 1, 0x1a, 0xe1,
        ]);
    });

    it('rejects malformed compact IPv4 peer info', () => {
        expectDhtError(
            () => decodeCompactPeer(new Uint8Array(5)),
            DHTErrorCode.INVALID_COMPACT_PEER,
        );
        expectDhtError(
            () => decodeCompactPeers(new Uint8Array(7)),
            DHTErrorCode.INVALID_COMPACT_PEER,
        );
        expectDhtError(
            () => encodeCompactPeer({ host: '127.0.0', port: 6881 }),
            DHTErrorCode.INVALID_IPV4_HOST,
        );
        expectDhtError(
            () => encodeCompactPeer({ host: '127.0.0.256', port: 6881 }),
            DHTErrorCode.INVALID_IPV4_HOST,
        );
        expectDhtError(
            () => encodeCompactPeer({ host: '127.0.0.1', port: 65536 }),
            DHTErrorCode.INVALID_PORT,
        );
    });
});

describe('compact DHT nodes', () => {
    it('decodes compact node info', () => {
        const id = new Uint8Array(20).fill(1);
        const node = decodeCompactNode(new Uint8Array([...id, 127, 0, 0, 1, 0x1a, 0xe1]));

        expect([...node.id]).toEqual([...id]);
        expect(node.host).toBe('127.0.0.1');
        expect(node.port).toBe(6881);
    });

    it('decodes concatenated compact node info', () => {
        const firstId = new Uint8Array(20).fill(1);
        const secondId = new Uint8Array(20).fill(2);

        const nodes = decodeCompactNodes(
            new Uint8Array([...firstId, 127, 0, 0, 1, 0x1a, 0xe1, ...secondId, 10, 0, 0, 2, 0, 80]),
        );

        expect(nodes).toHaveLength(2);
        expect([...nodes[0]!.id]).toEqual([...firstId]);
        expect(nodes[0]!.host).toBe('127.0.0.1');
        expect(nodes[0]!.port).toBe(6881);
        expect([...nodes[1]!.id]).toEqual([...secondId]);
        expect(nodes[1]!.host).toBe('10.0.0.2');
        expect(nodes[1]!.port).toBe(80);
    });

    it('encodes compact node info', () => {
        const id = new Uint8Array(20).fill(1);

        expect([...encodeCompactNode({ id, host: '127.0.0.1', port: 6881 })]).toEqual([
            ...id,
            127,
            0,
            0,
            1,
            0x1a,
            0xe1,
        ]);
    });

    it('rejects malformed compact node info', () => {
        expectDhtError(
            () => decodeCompactNode(new Uint8Array(25)),
            DHTErrorCode.INVALID_COMPACT_NODE,
        );
        expectDhtError(
            () => decodeCompactNodes(new Uint8Array(27)),
            DHTErrorCode.INVALID_COMPACT_NODE,
        );
        expectDhtError(
            () => encodeCompactNode({ id: new Uint8Array(19), host: '127.0.0.1', port: 6881 }),
            DHTErrorCode.INVALID_DHT_ID,
        );
        expectDhtError(
            () => encodeCompactNode({ id: new Uint8Array(20), host: 'x.0.0.1', port: 6881 }),
            DHTErrorCode.INVALID_IPV4_HOST,
        );
        expectDhtError(
            () => encodeCompactNode({ id: new Uint8Array(20), host: '127.0.0.1', port: -1 }),
            DHTErrorCode.INVALID_PORT,
        );
    });
});

const expectDhtError = (callback: () => unknown, code: DHTErrorCode): void => {
    try {
        callback();
        throw new Error('Expected callback to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        expect((error as DHTError).code).toBe(code);
    }
};
