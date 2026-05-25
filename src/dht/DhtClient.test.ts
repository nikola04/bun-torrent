import { describe, expect, it } from 'bun:test';

import { DHTError, DHTErrorCode } from './errors';
import { DhtClient, type DhtEndpoint } from './DhtClient';
import { decodeKrpcMessage, encodeKrpcMessage, KrpcQueryType } from './krpc';
import type { KrpcMessage } from './krpc';
import type { UdpSocketHandlers } from '../utils/UdpSocket';
import { encodeCompactNode, encodeCompactPeer } from './utils/compact';
import { DhtRoutingTable } from './RoutingTable';

describe('DhtClient', () => {
    it('sends ping queries and resolves matching responses', async () => {
        const socket = new FakeDhtSocket();
        const endpoint = remoteEndpoint();
        const remoteId = id(2);
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: (handlers) => socket.bind(handlers),
        });
        await client.start();

        const ping = client.ping(endpoint);
        await waitForSent(socket, 1);
        const sent = socket.sent[0]!;
        const query = decodeKrpcMessage(sent.data);

        expect(sent.endpoint).toEqual(endpoint);
        expect(query).toMatchObject({
            type: 'query',
            query: KrpcQueryType.Ping,
        });
        expect([...extractQueryId(query)]).toEqual([...id(1)]);

        socket.receive({
            type: 'response',
            transactionId: query.transactionId,
            id: remoteId,
        });

        const response = await ping;
        expect(response.type).toBe('response');
        expect([...response.id]).toEqual([...remoteId]);
        expect(client.routingTable.get(remoteId)).toEqual({ id: remoteId, ...endpoint });
    });

    it('sends find_node queries', async () => {
        const socket = new FakeDhtSocket();
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: (handlers) => socket.bind(handlers),
        });
        await client.start();

        const request = client.findNode(remoteEndpoint(), id(9));
        await waitForSent(socket, 1);
        const query = decodeKrpcMessage(socket.sent[0]!.data);

        expect(query).toMatchObject({
            type: 'query',
            query: KrpcQueryType.FindNode,
        });
        expect('target' in query ? [...query.target] : []).toEqual([...id(9)]);

        socket.receive({
            type: 'response',
            transactionId: query.transactionId,
            id: id(2),
            nodes: new Uint8Array(),
        });
        await request;
    });

    it('sends get_peers queries', async () => {
        const socket = new FakeDhtSocket();
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: (handlers) => socket.bind(handlers),
        });
        await client.start();

        const request = client.getPeers(remoteEndpoint(), id(7));
        await waitForSent(socket, 1);
        const query = decodeKrpcMessage(socket.sent[0]!.data);

        expect(query).toMatchObject({
            type: 'query',
            query: KrpcQueryType.GetPeers,
        });
        expect('infoHash' in query ? [...query.infoHash] : []).toEqual([...id(7)]);

        socket.receive({
            type: 'response',
            transactionId: query.transactionId,
            id: id(2),
            token: new Uint8Array([1]),
            values: [new Uint8Array([127, 0, 0, 1, 0x1a, 0xe1])],
        });
        await request;
    });

    it('rejects KRPC error responses', async () => {
        const socket = new FakeDhtSocket();
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: (handlers) => socket.bind(handlers),
        });
        await client.start();

        const request = client.ping(remoteEndpoint());
        await waitForSent(socket, 1);
        const query = decodeKrpcMessage(socket.sent[0]!.data);
        socket.receive({
            type: 'error',
            transactionId: query.transactionId,
            code: 201,
            message: 'generic error',
        });

        await expectDhtReject(request, DHTErrorCode.DHT_QUERY_FAILED);
    });

    it('rejects timed out queries', async () => {
        const socket = new FakeDhtSocket();
        const client = new DhtClient({
            nodeId: id(1),
            timeoutMs: 1,
            createSocket: (handlers) => socket.bind(handlers),
        });
        await client.start();

        await expectDhtReject(client.ping(remoteEndpoint()), DHTErrorCode.DHT_QUERY_TIMEOUT);
    });

    it('closes the socket and rejects pending queries', async () => {
        const socket = new FakeDhtSocket();
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: (handlers) => socket.bind(handlers),
        });
        await client.start();

        const request = client.ping(remoteEndpoint());
        await waitForSent(socket, 1);
        client.close();

        expect(socket.closed).toBe(true);
        await expectDhtReject(request, DHTErrorCode.DHT_CLIENT_CLOSED);
    });

    it('reuses one socket when started concurrently', async () => {
        const socket = new FakeDhtSocket();
        let socketsCreated = 0;
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: async (handlers) => {
                socketsCreated += 1;
                await new Promise((resolve) => setTimeout(resolve, 0));
                return socket.bind(handlers);
            },
        });

        await Promise.all([client.start(), client.start(), client.start()]);

        expect(socketsCreated).toBe(1);
        client.close();
        expect(socket.closed).toBe(true);
    });

    it('returns cached peers without performing a new lookup', async () => {
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: async () => {
                throw new Error('socket should not be created when peers are cached');
            },
        });

        client.rememberPeers(id(9), [{ ip: '10.0.0.1', port: 51413 }]);

        await expect(client.lookupPeers(id(9))).resolves.toEqual([{ ip: '10.0.0.1', port: 51413 }]);
    });

    it('looks up peers from known routing table nodes', async () => {
        const socket = new FakeDhtSocket();
        const knownNode = { id: id(2), host: '127.0.0.1', port: 6881 };
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: (handlers) => socket.bind(handlers),
        });
        client.routingTable.add(knownNode);
        await client.start();

        const lookup = client.lookupPeers(id(9));
        await waitForSent(socket, 1);
        const query = decodeKrpcMessage(socket.sent[0]!.data);

        expect(query).toMatchObject({
            type: 'query',
            query: KrpcQueryType.GetPeers,
        });

        socket.receive({
            type: 'response',
            transactionId: query.transactionId,
            id: knownNode.id,
            token: new Uint8Array([1]),
            values: [encodeCompactPeer({ host: '10.0.0.1', port: 51413 })],
        });

        await expect(lookup).resolves.toEqual([{ ip: '10.0.0.1', port: 51413 }]);
    });

    it('caches peers discovered from the network for later lookups', async () => {
        const socket = new FakeDhtSocket();
        const knownNode = { id: id(2), host: '127.0.0.1', port: 6881 };
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: (handlers) => socket.bind(handlers),
        });
        client.routingTable.add(knownNode);
        await client.start();

        const firstLookup = client.lookupPeers(id(9));
        await waitForSent(socket, 1);
        const query = decodeKrpcMessage(socket.sent[0]!.data);

        socket.receive({
            type: 'response',
            transactionId: query.transactionId,
            id: knownNode.id,
            token: new Uint8Array([1]),
            values: [encodeCompactPeer({ host: '10.0.0.1', port: 51413 })],
        });

        await expect(firstLookup).resolves.toEqual([{ ip: '10.0.0.1', port: 51413 }]);
        await expect(client.lookupPeers(id(9))).resolves.toEqual([{ ip: '10.0.0.1', port: 51413 }]);
        expect(socket.sent).toHaveLength(1);
    });

    it('bootstraps from configured endpoints', async () => {
        const socket = new FakeDhtSocket();
        const endpoint = remoteEndpoint();
        const bootstrapNodeId = id(2);
        const discoveredNode = { id: id(3), host: '127.0.0.2', port: 6882 };
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: (handlers) => socket.bind(handlers),
        });
        await client.start();

        const bootstrap = client.bootstrap([endpoint]);
        await waitForSent(socket, 1);
        const query = decodeKrpcMessage(socket.sent[0]!.data);

        expect(socket.sent[0]!.endpoint).toEqual(endpoint);
        expect(query).toMatchObject({
            type: 'query',
            query: KrpcQueryType.FindNode,
        });

        socket.receive({
            type: 'response',
            transactionId: query.transactionId,
            id: bootstrapNodeId,
            nodes: encodeCompactNode(discoveredNode),
        });

        await bootstrap;
        expect(client.routingTable.get(bootstrapNodeId)).toEqual({
            id: bootstrapNodeId,
            ...endpoint,
        });
        expect(client.routingTable.get(discoveredNode.id)).toEqual(discoveredNode);
    });

    it('rejects bootstrap when every bootstrap query fails', async () => {
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: async () => {
                throw new Error('udp unavailable');
            },
        });

        await expectDhtReject(
            client.bootstrap([remoteEndpoint()]),
            DHTErrorCode.DHT_BOOTSTRAP_FAILED,
        );
    });

    it('continues lookup through closer nodes until peers are found', async () => {
        const socket = new FakeDhtSocket();
        const firstNode = { id: id(2), host: '127.0.0.1', port: 6881 };
        const secondNode = { id: id(3), host: '127.0.0.2', port: 6882 };
        const client = new DhtClient({
            nodeId: id(1),
            createSocket: (handlers) => socket.bind(handlers),
            lookupConcurrency: 1,
        });
        client.routingTable.add(firstNode);
        await client.start();

        const lookup = client.lookupPeers(id(9));
        await waitForSent(socket, 1);
        const firstQuery = decodeKrpcMessage(socket.sent[0]!.data);

        socket.receive({
            type: 'response',
            transactionId: firstQuery.transactionId,
            id: firstNode.id,
            nodes: encodeCompactNode(secondNode),
        });

        await waitForSent(socket, 2);
        const secondQuery = decodeKrpcMessage(socket.sent[1]!.data);
        expect(socket.sent[1]!.endpoint).toEqual({
            host: secondNode.host,
            port: secondNode.port,
        });

        socket.receive({
            type: 'response',
            transactionId: secondQuery.transactionId,
            id: secondNode.id,
            token: new Uint8Array([1]),
            values: [encodeCompactPeer({ host: '10.0.0.1', port: 51413 })],
        });

        await expect(lookup).resolves.toEqual([{ ip: '10.0.0.1', port: 51413 }]);
    });

    it('keeps lookup candidates even when routing table buckets reject them', async () => {
        const socket = new FakeDhtSocket();
        const firstNode = { id: idWithLastByte(0x80), host: '127.0.0.1', port: 6881 };
        const secondNode = { id: idWithLastByte(0x81), host: '127.0.0.2', port: 6882 };
        const client = new DhtClient({
            nodeId: id(0),
            createSocket: (handlers) => socket.bind(handlers),
            lookupConcurrency: 1,
            routingTable: new DhtRoutingTable(id(0), { bucketSize: 1 }),
        });
        client.routingTable.add(firstNode);
        await client.start();

        const lookup = client.lookupPeers(idWithLastByte(0xff));
        await waitForSent(socket, 1);
        const firstQuery = decodeKrpcMessage(socket.sent[0]!.data);

        socket.receive({
            type: 'response',
            transactionId: firstQuery.transactionId,
            id: firstNode.id,
            nodes: encodeCompactNode(secondNode),
        });

        await waitForSent(socket, 2);
        expect(socket.sent[1]!.endpoint).toEqual({
            host: secondNode.host,
            port: secondNode.port,
        });

        const secondQuery = decodeKrpcMessage(socket.sent[1]!.data);
        socket.receive({
            type: 'response',
            transactionId: secondQuery.transactionId,
            id: secondNode.id,
            token: new Uint8Array([1]),
            values: [encodeCompactPeer({ host: '10.0.0.1', port: 51413 })],
        });

        await expect(lookup).resolves.toEqual([{ ip: '10.0.0.1', port: 51413 }]);
        expect(client.routingTable.get(secondNode.id)).toBeUndefined();
    });
});

class FakeDhtSocket {
    public readonly sent: Array<{ data: Uint8Array; endpoint: DhtEndpoint }> = [];
    public closed = false;
    private handlers: UdpSocketHandlers | null = null;

    public bind(handlers: UdpSocketHandlers): FakeDhtSocket {
        this.handlers = handlers;
        return this;
    }

    public send(data: Uint8Array, port: number, host: string): void {
        this.sent.push({ data, endpoint: { host, port } });
    }

    public close(): void {
        this.closed = true;
    }

    public receive(message: KrpcMessage): void {
        this.handlers?.data(this, encodeKrpcMessage(message));
    }
}

const remoteEndpoint = (): DhtEndpoint => ({ host: '127.0.0.1', port: 6881 });

const id = (value: number): Uint8Array => new Uint8Array(20).fill(value);

const idWithLastByte = (lastByte: number): Uint8Array => {
    const bytes = new Uint8Array(20);
    bytes[19] = lastByte;
    return bytes;
};

const extractQueryId = (message: KrpcMessage): Uint8Array => {
    if (message.type !== 'query') throw new Error('Expected query message');
    return message.id;
};

const expectDhtReject = async (promise: Promise<unknown>, code: DHTErrorCode): Promise<void> => {
    try {
        await promise;
        throw new Error('Expected promise to reject');
    } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        expect((error as DHTError).code).toBe(code);
    }
};

const waitForSent = async (socket: FakeDhtSocket, count: number): Promise<void> => {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (socket.sent.length >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    throw new Error(`Expected ${count} sent packets, got ${socket.sent.length}`);
};
