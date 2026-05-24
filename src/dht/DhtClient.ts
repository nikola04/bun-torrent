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
import { decodeCompactNodes, decodeCompactPeers, type DhtNode } from './utils/compact';
import { compareDistance, DHT_ID_LENGTH, isDhtId } from './utils/distance';
import type { PeerInfo } from '../tracker/types';
import { defaults } from '../configs/defaults';
import { lookup } from 'dns/promises';

export type DhtEndpoint = {
    host: string;
    port: number;
};

export type DhtClientOptions = {
    nodeId: Uint8Array;
    bootstrapNodes?: DhtEndpoint[];
    lookupConcurrency?: number;
    maxLookupRounds?: number;
    peerCacheTtlMs?: number;
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

type CachedPeer = {
    peer: PeerInfo;
    seenAt: number;
};

export class DhtClient {
    public readonly routingTable: DhtRoutingTable;

    private readonly nodeId: Uint8Array;
    private readonly bootstrapNodes: DhtEndpoint[];
    private readonly lookupConcurrency: number;
    private readonly maxLookupRounds: number;
    private readonly peerCacheTtlMs: number;
    private readonly timeoutMs: number;
    private readonly transactionIds: KrpcTransactionIdGenerator;
    private readonly createSocket: CreateUdpSocket;
    private readonly pending = new Map<string, PendingQuery>();
    private readonly peerCache = new Map<string, Map<string, CachedPeer>>();

    private socket: UdpSocket | null = null;
    private starting: Promise<void> | null = null;
    private closed = false;

    public constructor(options: DhtClientOptions) {
        if (!isDhtId(options.nodeId)) {
            throw new DHTError(
                DHTErrorCode.INVALID_DHT_ID,
                `DHT node id must be exactly ${DHT_ID_LENGTH} bytes`,
            );
        }

        this.nodeId = options.nodeId.slice();
        this.bootstrapNodes = options.bootstrapNodes ?? [...defaults.dht.bootstrapNodes];
        this.lookupConcurrency = options.lookupConcurrency ?? defaults.dht.lookupConcurrency;
        this.maxLookupRounds = options.maxLookupRounds ?? defaults.dht.maxLookupRounds;
        this.peerCacheTtlMs = options.peerCacheTtlMs ?? defaults.dht.peerCacheTtlMs;
        this.timeoutMs =
            options.timeoutMs ?? defaults.dht.queryTimeoutMs ?? DEFAULT_DHT_QUERY_TIMEOUT_MS;
        this.routingTable = options.routingTable ?? new DhtRoutingTable(this.nodeId);
        this.transactionIds = options.transactionIds ?? new KrpcTransactionIdGenerator();
        this.createSocket = options.createSocket ?? createUdpSocket;
    }

    public async start(): Promise<void> {
        if (this.socket) return;
        if (this.starting) return this.starting;
        if (this.closed) {
            throw new DHTError(DHTErrorCode.DHT_CLIENT_CLOSED, 'DHT client is closed');
        }

        this.starting = this.openSocket();
        try {
            await this.starting;
        } finally {
            this.starting = null;
        }
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

    public rememberPeers(infoHash: Uint8Array, peers: PeerInfo[]): void {
        if (peers.length === 0) return;

        const key = infoHashKey(infoHash);
        const bucket = this.peerCache.get(key) ?? new Map<string, CachedPeer>();
        const seenAt = Date.now();

        for (const peer of peers) {
            bucket.set(peerKey(peer), { peer, seenAt });
        }

        this.peerCache.set(key, bucket);
    }

    public async bootstrap(
        nodes: DhtEndpoint[] = this.bootstrapNodes,
        target: Uint8Array = this.nodeId,
    ): Promise<void> {
        const previousSize = this.routingTable.size;
        const responses = await Promise.allSettled(nodes.map((node) => this.findNode(node, target)));
        const errors: unknown[] = [];

        for (const response of responses) {
            if (response.status !== 'fulfilled') {
                errors.push(response.reason);
                continue;
            }

            if ('nodes' in response.value) this.addCompactNodes(response.value.nodes);
        }

        if (this.routingTable.size === previousSize && errors.length === responses.length) {
            throw new DHTError(
                DHTErrorCode.DHT_BOOTSTRAP_FAILED,
                'DHT bootstrap failed',
                errors,
            );
        }
    }

    public async lookupPeers(infoHash: Uint8Array): Promise<PeerInfo[]> {
        const cachedPeers = this.getCachedPeers(infoHash);
        if (cachedPeers.length > 0) return cachedPeers;

        const peers = new Map<string, PeerInfo>();
        const queried = new Set<string>();
        const candidates = new Map<string, DhtNode>();

        if (this.routingTable.size === 0) await this.bootstrap(this.bootstrapNodes, infoHash);
        for (const node of this.routingTable.closest(infoHash, this.lookupConcurrency)) {
            candidates.set(endpointKey(node), node);
        }

        for (let round = 0; round < this.maxLookupRounds; round++) {
            const nodes = [...candidates.values()]
                .filter((node) => !queried.has(endpointKey(node)))
                .sort((left, right) => compareDistance(left.id, right.id, infoHash))
                .slice(0, this.lookupConcurrency);

            if (nodes.length === 0) break;

            nodes.forEach((node) => queried.add(endpointKey(node)));
            const responses = await Promise.allSettled(
                nodes.map((node) => this.getPeers(node, infoHash)),
            );

            for (const response of responses) {
                if (response.status !== 'fulfilled') continue;

                if ('nodes' in response.value) {
                    for (const node of this.addCompactNodes(response.value.nodes)) {
                        candidates.set(endpointKey(node), node);
                    }
                }

                if (!('values' in response.value)) continue;

                for (const value of response.value.values) {
                    for (const peer of decodeCompactPeers(value)) {
                        peers.set(`${peer.host}:${peer.port}`, { ip: peer.host, port: peer.port });
                    }
                }
            }
        }

        const discoveredPeers = [...peers.values()];
        this.rememberPeers(infoHash, discoveredPeers);
        return discoveredPeers;
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
        const resolvedEndpoint = await this.resolveEndpoint(endpoint);

        if (this.closed || !this.socket) {
            throw new DHTError(DHTErrorCode.DHT_CLIENT_CLOSED, 'DHT client is closed');
        }

        return new Promise<KrpcResponse>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(key);
                reject(new DHTError(DHTErrorCode.DHT_QUERY_TIMEOUT, 'DHT query timed out'));
            }, this.timeoutMs);
            timeout.unref();

            this.pending.set(key, { endpoint: resolvedEndpoint, timeout, resolve, reject });

            try {
                void this.socket!.send(
                    encodeKrpcMessage(message),
                    resolvedEndpoint.port,
                    resolvedEndpoint.host,
                );
            } catch (error) {
                clearTimeout(timeout);
                this.pending.delete(key);
                reject(error);
            }
        });
    }

    private async openSocket(): Promise<void> {
        const socket = await this.createSocket({
            data: (_socket, data) => this.handleData(data),
            error: (_socket, error) => this.rejectAll(error),
        });

        if (this.closed) {
            socket.close();
            return;
        }

        this.socket = socket;
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

    private addCompactNodes(nodes: Uint8Array): DhtNode[] {
        const decoded = decodeCompactNodes(nodes);

        for (const node of decoded) {
            this.routingTable.add(node);
        }

        return decoded;
    }

    private getCachedPeers(infoHash: Uint8Array): PeerInfo[] {
        const bucket = this.peerCache.get(infoHashKey(infoHash));
        if (!bucket) return [];

        const minSeenAt = Date.now() - this.peerCacheTtlMs;
        const peers: PeerInfo[] = [];

        for (const [key, cachedPeer] of bucket) {
            if (cachedPeer.seenAt < minSeenAt) {
                bucket.delete(key);
                continue;
            }

            peers.push(cachedPeer.peer);
        }

        if (bucket.size === 0) {
            this.peerCache.delete(infoHashKey(infoHash));
        }

        return peers;
    }

    private async resolveEndpoint(endpoint: DhtEndpoint): Promise<DhtEndpoint> {
        if (isIPv4(endpoint.host)) return endpoint;

        const { address } = await lookup(endpoint.host, { family: 4 });
        return { host: address, port: endpoint.port };
    }

    private rejectAll(error: unknown): void {
        for (const [key, pending] of this.pending) {
            clearTimeout(pending.timeout);
            pending.reject(error);
            this.pending.delete(key);
        }
    }
}

const endpointKey = (endpoint: DhtEndpoint): string => `${endpoint.host}:${endpoint.port}`;
const infoHashKey = (infoHash: Uint8Array): string => infoHash.toHex();
const peerKey = (peer: PeerInfo): string => `${peer.ip}:${peer.port}`;

const isIPv4 = (host: string): boolean => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
