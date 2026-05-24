import { DHTError, DHTErrorCode } from './errors';
import {
    decodeKrpcMessage,
    encodeKrpcMessage,
    KrpcQueryType,
    KrpcTransactionIdGenerator,
    krpcTransactionKey,
    type KrpcMessage,
    type KrpcResponse,
} from './krpc';
import { DhtRoutingTable } from './RoutingTable';
import { createUdpSocket, type CreateUdpSocket, type UdpSocket } from '../utils/UdpSocket';
import { DHT_ID_LENGTH, isDhtId } from './utils/distance';

export type DhtEndpoint = {
    host: string;
    port: number;
};

export type DhtClientOptions = {
    nodeId: Uint8Array;
    timeoutMs?: number;
    routingTable?: DhtRoutingTable;
    transactionIds?: KrpcTransactionIdGenerator;
    createSocket?: CreateUdpSocket;
};

type PendingQuery = {
    endpoint: DhtEndpoint;
    timeout: ReturnType<typeof setTimeout>;
    resolve: (response: KrpcResponse) => void;
    reject: (error: unknown) => void;
};

const DEFAULT_DHT_QUERY_TIMEOUT_MS = 10_000;

export class DhtClient {
    public readonly routingTable: DhtRoutingTable;

    private readonly nodeId: Uint8Array;
    private readonly timeoutMs: number;
    private readonly transactionIds: KrpcTransactionIdGenerator;
    private readonly createSocket: CreateUdpSocket;
    private readonly pending = new Map<string, PendingQuery>();

    private socket: UdpSocket | null = null;
    private closed = false;

    public constructor(options: DhtClientOptions) {
        if (!isDhtId(options.nodeId)) {
            throw new DHTError(
                DHTErrorCode.INVALID_DHT_ID,
                `DHT node id must be exactly ${DHT_ID_LENGTH} bytes`,
            );
        }

        this.nodeId = options.nodeId.slice();
        this.timeoutMs = options.timeoutMs ?? DEFAULT_DHT_QUERY_TIMEOUT_MS;
        this.routingTable = options.routingTable ?? new DhtRoutingTable(this.nodeId);
        this.transactionIds = options.transactionIds ?? new KrpcTransactionIdGenerator();
        this.createSocket = options.createSocket ?? createUdpSocket;
    }

    public async start(): Promise<void> {
        if (this.socket) return;
        if (this.closed) {
            throw new DHTError(DHTErrorCode.DHT_CLIENT_CLOSED, 'DHT client is closed');
        }

        this.socket = await this.createSocket({
            data: (_socket, data) => this.handleData(data),
            error: (_socket, error) => this.rejectAll(error),
        });
    }

    public close(): void {
        if (this.closed) return;

        this.closed = true;
        this.socket?.close();
        this.socket = null;
        this.rejectAll(new DHTError(DHTErrorCode.DHT_CLIENT_CLOSED, 'DHT client closed'));
    }

    public ping(endpoint: DhtEndpoint): Promise<KrpcResponse> {
        return this.sendQuery(endpoint, { query: KrpcQueryType.Ping });
    }

    public findNode(endpoint: DhtEndpoint, target: Uint8Array): Promise<KrpcResponse> {
        return this.sendQuery(endpoint, { query: KrpcQueryType.FindNode, target });
    }

    public getPeers(endpoint: DhtEndpoint, infoHash: Uint8Array): Promise<KrpcResponse> {
        return this.sendQuery(endpoint, { query: KrpcQueryType.GetPeers, infoHash });
    }

    private async sendQuery(
        endpoint: DhtEndpoint,
        query:
            | { query: KrpcQueryType.Ping }
            | { query: KrpcQueryType.FindNode; target: Uint8Array }
            | { query: KrpcQueryType.GetPeers; infoHash: Uint8Array },
    ): Promise<KrpcResponse> {
        if (this.closed) {
            throw new DHTError(DHTErrorCode.DHT_CLIENT_CLOSED, 'DHT client is closed');
        }

        if (!this.socket) await this.start();

        const transactionId = this.transactionIds.create();
        const key = krpcTransactionKey(transactionId);
        const message = this.createQueryMessage(transactionId, query);

        return new Promise<KrpcResponse>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(key);
                reject(new DHTError(DHTErrorCode.DHT_QUERY_TIMEOUT, 'DHT query timed out'));
            }, this.timeoutMs);
            timeout.unref();

            this.pending.set(key, { endpoint, timeout, resolve, reject });

            try {
                void this.socket!.send(encodeKrpcMessage(message), endpoint.port, endpoint.host);
            } catch (error) {
                clearTimeout(timeout);
                this.pending.delete(key);
                reject(error);
            }
        });
    }

    private createQueryMessage(
        transactionId: Uint8Array,
        query:
            | { query: KrpcQueryType.Ping }
            | { query: KrpcQueryType.FindNode; target: Uint8Array }
            | { query: KrpcQueryType.GetPeers; infoHash: Uint8Array },
    ): KrpcMessage {
        switch (query.query) {
            case KrpcQueryType.Ping:
                return { type: 'query', transactionId, query: query.query, id: this.nodeId };
            case KrpcQueryType.FindNode:
                return {
                    type: 'query',
                    transactionId,
                    query: query.query,
                    id: this.nodeId,
                    target: query.target,
                };
            case KrpcQueryType.GetPeers:
                return {
                    type: 'query',
                    transactionId,
                    query: query.query,
                    id: this.nodeId,
                    infoHash: query.infoHash,
                };
        }
    }

    private handleData(data: Uint8Array): void {
        let message: KrpcMessage;
        try {
            message = decodeKrpcMessage(data);
        } catch {
            return;
        }

        const key = krpcTransactionKey(message.transactionId);
        const pending = this.pending.get(key);
        if (!pending) return;

        clearTimeout(pending.timeout);
        this.pending.delete(key);

        if (message.type === 'error') {
            pending.reject(
                new DHTError(DHTErrorCode.DHT_QUERY_FAILED, `DHT query failed: ${message.message}`, [
                    message,
                ]),
            );
            return;
        }

        if (message.type !== 'response') {
            pending.reject(
                new DHTError(DHTErrorCode.INVALID_KRPC_MESSAGE, 'Expected KRPC response message', [
                    message,
                ]),
            );
            return;
        }

        this.routingTable.add({
            id: message.id,
            host: pending.endpoint.host,
            port: pending.endpoint.port,
        });
        pending.resolve(message);
    }

    private rejectAll(error: unknown): void {
        for (const [key, pending] of this.pending) {
            clearTimeout(pending.timeout);
            pending.reject(error);
            this.pending.delete(key);
        }
    }
}
