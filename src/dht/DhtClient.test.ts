import { describe, expect, it } from 'bun:test';

import { DHTError, DHTErrorCode } from './errors';
import { DhtClient, type DhtEndpoint } from './DhtClient';
import { decodeKrpcMessage, encodeKrpcMessage, KrpcQueryType } from './krpc';
import type { KrpcMessage } from './krpc';
import type { UdpSocketHandlers } from '../utils/UdpSocket';

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
        client.close();

        expect(socket.closed).toBe(true);
        await expectDhtReject(request, DHTErrorCode.DHT_CLIENT_CLOSED);
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
