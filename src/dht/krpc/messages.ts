import { decodeBencode, encodeBencode, toBValue, type BDict, type BValue } from '../../torrent/bencode';
import { DHTError, DHTErrorCode } from '../errors';
import { type KrpcError, type KrpcMessage, KrpcMessageType, KrpcQueryType, type KrpcResponse } from './types';

const textDecoder = new TextDecoder();

export const encodeKrpcMessage = (message: KrpcMessage): Uint8Array => {
    switch (message.type) {
        case 'query':
            return encodeKrpcQuery(message);
        case 'response':
            return encodeKrpcResponse(message);
        case 'error':
            return encodeKrpcError(message);
    }
};

export const decodeKrpcMessage = (bytes: Uint8Array): KrpcMessage => {
    const root = expectDict(decodeBencode(bytes), 'root');
    const transactionId = expectBytes(root.get('t'), 't');
    const messageType = expectString(root.get('y'), 'y');

    switch (messageType) {
        case KrpcMessageType.Query:
            return decodeKrpcQuery(root, transactionId);
        case KrpcMessageType.Response:
            return decodeKrpcResponse(root, transactionId);
        case KrpcMessageType.Error:
            return decodeKrpcError(root, transactionId);
        default:
            throw invalidKrpcMessage(`Unsupported KRPC message type: ${messageType}`);
    }
};

const encodeKrpcQuery = (message: Extract<KrpcMessage, { type: 'query' }>): Uint8Array => {
    switch (message.query) {
        case KrpcQueryType.Ping:
            return encodeBencode(
                toBValue({
                    a: { id: message.id },
                    q: KrpcQueryType.Ping,
                    t: message.transactionId,
                    y: KrpcMessageType.Query,
                }),
            );
        case KrpcQueryType.FindNode:
            return encodeBencode(
                toBValue({
                    a: { id: message.id, target: message.target },
                    q: KrpcQueryType.FindNode,
                    t: message.transactionId,
                    y: KrpcMessageType.Query,
                }),
            );
        case KrpcQueryType.GetPeers:
            return encodeBencode(
                toBValue({
                    a: { id: message.id, info_hash: message.infoHash },
                    q: KrpcQueryType.GetPeers,
                    t: message.transactionId,
                    y: KrpcMessageType.Query,
                }),
            );
    }

    throw invalidKrpcMessage(`Unsupported KRPC query type: ${(message as { query: string }).query}`);
};

const encodeKrpcResponse = (message: KrpcResponse): Uint8Array => {
    const response: Record<string, number | string | Uint8Array | Uint8Array[]> = { id: message.id };

    if ('nodes' in message) response.nodes = message.nodes;
    if ('token' in message && message.token) response.token = message.token;
    if ('values' in message) response.values = message.values;

    return encodeBencode(
        toBValue({
            r: response,
            t: message.transactionId,
            y: KrpcMessageType.Response,
        }),
    );
};

const encodeKrpcError = (message: KrpcError): Uint8Array =>
    encodeBencode(
        toBValue({
            e: [message.code, message.message],
            t: message.transactionId,
            y: KrpcMessageType.Error,
        }),
    );

const decodeKrpcQuery = (root: BDict, transactionId: Uint8Array): KrpcMessage => {
    const query = expectString(root.get('q'), 'q');
    const args = expectDict(root.get('a'), 'a');
    const id = expectBytes(args.get('id'), 'a.id');

    switch (query) {
        case KrpcQueryType.Ping:
            return { type: 'query', transactionId, query, id };
        case KrpcQueryType.FindNode:
            return {
                type: 'query',
                transactionId,
                query,
                id,
                target: expectBytes(args.get('target'), 'a.target'),
            };
        case KrpcQueryType.GetPeers:
            return {
                type: 'query',
                transactionId,
                query,
                id,
                infoHash: expectBytes(args.get('info_hash'), 'a.info_hash'),
            };
        default:
            throw invalidKrpcMessage(`Unsupported KRPC query type: ${query}`);
    }
};

const decodeKrpcResponse = (root: BDict, transactionId: Uint8Array): KrpcResponse => {
    const response = expectDict(root.get('r'), 'r');
    const id = expectBytes(response.get('id'), 'r.id');
    const token = getOptionalBytes(response, 'token');
    const nodes = getOptionalBytes(response, 'nodes');
    const values = getOptionalBytesList(response, 'values');

    if (values) {
        if (!token) throw invalidKrpcMessage('KRPC get_peers values response is missing token');
        return { type: 'response', transactionId, id, token, values };
    }

    if (nodes) {
        return token
            ? { type: 'response', transactionId, id, nodes, token }
            : { type: 'response', transactionId, id, nodes };
    }

    return { type: 'response', transactionId, id };
};

const decodeKrpcError = (root: BDict, transactionId: Uint8Array): KrpcError => {
    const error = expectList(root.get('e'), 'e');

    if (error.length !== 2 || typeof error[0] !== 'number') {
        throw invalidKrpcMessage('KRPC error must be [code, message]');
    }

    return {
        type: 'error',
        transactionId,
        code: error[0],
        message: expectString(error[1], 'e.1'),
    };
};

const getOptionalBytes = (dict: BDict, field: string): Uint8Array | undefined => {
    const value = dict.get(field);
    if (value === undefined) return undefined;
    return expectBytes(value, field);
};

const getOptionalBytesList = (dict: BDict, field: string): Uint8Array[] | undefined => {
    const value = dict.get(field);
    if (value === undefined) return undefined;

    return expectList(value, field).map((item, index) => expectBytes(item, `${field}.${index}`));
};

const expectDict = (value: BValue | undefined, field: string): BDict => {
    if (!(value instanceof Map)) throw invalidKrpcMessage(`KRPC field ${field} must be a dictionary`);
    return value;
};

const expectList = (value: BValue | undefined, field: string): BValue[] => {
    if (!Array.isArray(value)) throw invalidKrpcMessage(`KRPC field ${field} must be a list`);
    return value;
};

const expectBytes = (value: BValue | undefined, field: string): Uint8Array => {
    if (!(value instanceof Uint8Array)) throw invalidKrpcMessage(`KRPC field ${field} must be bytes`);
    return value;
};

const expectString = (value: BValue | undefined, field: string): string =>
    textDecoder.decode(expectBytes(value, field));

const invalidKrpcMessage = (message: string): DHTError =>
    new DHTError(DHTErrorCode.INVALID_KRPC_MESSAGE, message);
