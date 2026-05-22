import { describe, expect, it } from 'bun:test';

import { encodeBencode, toBValue } from '../../torrent/bencode';
import { DHTError, DHTErrorCode } from '../errors';
import { decodeKrpcMessage, encodeKrpcMessage } from './messages';
import { KrpcMessageType, KrpcQueryType, type KrpcMessage } from './types';

describe('encodeKrpcMessage/decodeKrpcMessage queries', () => {
    it('round trips ping queries', () => {
        const message: KrpcMessage = {
            type: 'query',
            transactionId: bytes([1, 2]),
            query: KrpcQueryType.Ping,
            id: id(1),
        };

        expectMessage(decodeKrpcMessage(encodeKrpcMessage(message)), message);
    });

    it('round trips find_node queries', () => {
        const message: KrpcMessage = {
            type: 'query',
            transactionId: bytes([1, 2]),
            query: KrpcQueryType.FindNode,
            id: id(1),
            target: id(2),
        };

        expectMessage(decodeKrpcMessage(encodeKrpcMessage(message)), message);
    });

    it('round trips get_peers queries', () => {
        const message: KrpcMessage = {
            type: 'query',
            transactionId: bytes([1, 2]),
            query: KrpcQueryType.GetPeers,
            id: id(1),
            infoHash: id(3),
        };

        expectMessage(decodeKrpcMessage(encodeKrpcMessage(message)), message);
    });
});

describe('encodeKrpcMessage/decodeKrpcMessage responses', () => {
    it('round trips ping responses', () => {
        const message: KrpcMessage = {
            type: 'response',
            transactionId: bytes([1, 2]),
            id: id(1),
        };

        expectMessage(decodeKrpcMessage(encodeKrpcMessage(message)), message);
    });

    it('round trips node responses', () => {
        const message: KrpcMessage = {
            type: 'response',
            transactionId: bytes([1, 2]),
            id: id(1),
            token: bytes([9, 9]),
            nodes: bytes([1, 2, 3]),
        };

        expectMessage(decodeKrpcMessage(encodeKrpcMessage(message)), message);
    });

    it('round trips values responses', () => {
        const message: KrpcMessage = {
            type: 'response',
            transactionId: bytes([1, 2]),
            id: id(1),
            token: bytes([9, 9]),
            values: [bytes([127, 0, 0, 1, 0x1a, 0xe1])],
        };

        expectMessage(decodeKrpcMessage(encodeKrpcMessage(message)), message);
    });
});

describe('encodeKrpcMessage/decodeKrpcMessage errors', () => {
    it('round trips error messages', () => {
        const message: KrpcMessage = {
            type: 'error',
            transactionId: bytes([1, 2]),
            code: 201,
            message: 'generic error',
        };

        expectMessage(decodeKrpcMessage(encodeKrpcMessage(message)), message);
    });
});

describe('decodeKrpcMessage validation', () => {
    it('rejects unsupported message types', () => {
        expectDhtError(
            () => decodeKrpcMessage(encodeBencode(toBValue({ t: bytes([1]), y: 'x' }))),
            DHTErrorCode.INVALID_KRPC_MESSAGE,
        );
    });

    it('rejects malformed queries', () => {
        expectDhtError(
            () =>
                decodeKrpcMessage(
                    encodeBencode(
                        toBValue({
                            a: { id: id(1) },
                            q: KrpcQueryType.FindNode,
                            t: bytes([1]),
                            y: KrpcMessageType.Query,
                        }),
                    ),
                ),
            DHTErrorCode.INVALID_KRPC_MESSAGE,
        );
    });

    it('rejects values responses without token', () => {
        expectDhtError(
            () =>
                decodeKrpcMessage(
                    encodeBencode(
                        toBValue({
                            r: { id: id(1), values: [bytes([127, 0, 0, 1, 0x1a, 0xe1])] },
                            t: bytes([1]),
                            y: KrpcMessageType.Response,
                        }),
                    ),
                ),
            DHTErrorCode.INVALID_KRPC_MESSAGE,
        );
    });

    it('rejects malformed errors', () => {
        expectDhtError(
            () => decodeKrpcMessage(encodeBencode(toBValue({ e: [201], t: bytes([1]), y: KrpcMessageType.Error }))),
            DHTErrorCode.INVALID_KRPC_MESSAGE,
        );
    });
});

const id = (value: number): Uint8Array => new Uint8Array(20).fill(value);

const bytes = (values: number[]): Uint8Array => new Uint8Array(values);

const expectMessage = (actual: KrpcMessage, expected: KrpcMessage): void => {
    expect(normalize(actual)).toEqual(normalize(expected));
};

const normalize = (message: KrpcMessage): unknown => {
    switch (message.type) {
        case 'query':
            return 'target' in message
                ? { ...message, transactionId: [...message.transactionId], id: [...message.id], target: [...message.target] }
                : 'infoHash' in message
                  ? { ...message, transactionId: [...message.transactionId], id: [...message.id], infoHash: [...message.infoHash] }
                  : { ...message, transactionId: [...message.transactionId], id: [...message.id] };
        case 'response':
            return {
                ...message,
                transactionId: [...message.transactionId],
                id: [...message.id],
                ...('token' in message && message.token ? { token: [...message.token] } : {}),
                ...('nodes' in message ? { nodes: [...message.nodes] } : {}),
                ...('values' in message ? { values: message.values.map((value) => [...value]) } : {}),
            };
        case 'error':
            return { ...message, transactionId: [...message.transactionId] };
    }
};

const expectDhtError = (callback: () => unknown, code: DHTErrorCode): void => {
    try {
        callback();
        throw new Error('Expected callback to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        expect((error as DHTError).code).toBe(code);
    }
};
