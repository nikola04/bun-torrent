import { describe, expect, test } from 'bun:test';

import { BunTorrentError } from '../../utils/errors';
import { PeerMessageError, PeerMessageErrorCode, decodePeerMessage, encodePeerMessage } from '.';
import { readUInt32, writeUInt32 } from './helpers';

const expectPeerMessageError = (callback: () => unknown, code: PeerMessageErrorCode): void => {
    try {
        callback();
        throw new Error('Expected peer message operation to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(PeerMessageError);
        expect(error).toBeInstanceOf(BunTorrentError);
        expect((error as PeerMessageError).code).toBe(code);
    }
};

describe('peer message uint32 helpers', () => {
    test('writes uint32 values in big-endian order', () => {
        expect([...writeUInt32(0)]).toEqual([0, 0, 0, 0]);
        expect([...writeUInt32(1)]).toEqual([0, 0, 0, 1]);
        expect([...writeUInt32(13)]).toEqual([0, 0, 0, 13]);
        expect([...writeUInt32(0x01020304)]).toEqual([1, 2, 3, 4]);
    });

    test('reads uint32 values in big-endian order', () => {
        expect(readUInt32(new Uint8Array([0, 0, 0, 0]), 0)).toBe(0);
        expect(readUInt32(new Uint8Array([0, 0, 0, 13]), 0)).toBe(13);
        expect(readUInt32(new Uint8Array([9, 1, 2, 3, 4]), 1)).toBe(0x01020304);
    });

    test('rejects invalid uint32 values', () => {
        expectPeerMessageError(() => writeUInt32(-1), PeerMessageErrorCode.INVALID_UINT32);
        expectPeerMessageError(() => writeUInt32(1.5), PeerMessageErrorCode.INVALID_UINT32);
        expectPeerMessageError(() => writeUInt32(0x100000000), PeerMessageErrorCode.INVALID_UINT32);
    });

    test('rejects reading past the end of the input', () => {
        expectPeerMessageError(
            () => readUInt32(new Uint8Array([0, 0, 0]), 0),
            PeerMessageErrorCode.INVALID_LENGTH_PREFIX,
        );
    });
});

describe('encodePeerMessage', () => {
    test('encodes keep-alive', () => {
        expect([...encodePeerMessage({ type: 'keep-alive' })]).toEqual([0, 0, 0, 0]);
    });

    test('encodes choke', () => {
        expect([...encodePeerMessage({ type: 'choke' })]).toEqual([0, 0, 0, 1, 0]);
    });

    test('encodes unchoke', () => {
        expect([...encodePeerMessage({ type: 'unchoke' })]).toEqual([0, 0, 0, 1, 1]);
    });

    test('encodes interested', () => {
        expect([...encodePeerMessage({ type: 'interested' })]).toEqual([0, 0, 0, 1, 2]);
    });

    test('encodes not-interested', () => {
        expect([...encodePeerMessage({ type: 'not-interested' })]).toEqual([0, 0, 0, 1, 3]);
    });

    test('encodes have', () => {
        expect([...encodePeerMessage({ type: 'have', pieceIndex: 7 })]).toEqual([
            0, 0, 0, 5, 4, 0, 0, 0, 7,
        ]);
    });

    test('encodes bitfield', () => {
        expect([
            ...encodePeerMessage({ type: 'bitfield', bitfield: new Uint8Array([0b10100000]) }),
        ]).toEqual([0, 0, 0, 2, 5, 0b10100000]);
    });

    test('encodes request', () => {
        expect([
            ...encodePeerMessage({
                type: 'request',
                pieceIndex: 7,
                offset: 16_384,
                length: 16_384,
            }),
        ]).toEqual([0, 0, 0, 13, 6, 0, 0, 0, 7, 0, 0, 64, 0, 0, 0, 64, 0]);
    });

    test('encodes piece', () => {
        expect([
            ...encodePeerMessage({
                type: 'piece',
                pieceIndex: 7,
                offset: 16_384,
                block: new Uint8Array([1, 2, 3]),
            }),
        ]).toEqual([0, 0, 0, 12, 7, 0, 0, 0, 7, 0, 0, 64, 0, 1, 2, 3]);
    });

    test('encodes cancel', () => {
        expect([
            ...encodePeerMessage({ type: 'cancel', pieceIndex: 7, offset: 16_384, length: 16_384 }),
        ]).toEqual([0, 0, 0, 13, 8, 0, 0, 0, 7, 0, 0, 64, 0, 0, 0, 64, 0]);
    });

    test('rejects invalid request fields', () => {
        expectPeerMessageError(
            () => encodePeerMessage({ type: 'request', pieceIndex: -1, offset: 0, length: 16_384 }),
            PeerMessageErrorCode.INVALID_UINT32,
        );
    });
});

describe('decodePeerMessage', () => {
    test('decodes keep-alive', () => {
        expect(decodePeerMessage(new Uint8Array([0, 0, 0, 0]))).toEqual({ type: 'keep-alive' });
    });

    test('decodes control messages', () => {
        expect(decodePeerMessage(new Uint8Array([0, 0, 0, 1, 0]))).toEqual({ type: 'choke' });
        expect(decodePeerMessage(new Uint8Array([0, 0, 0, 1, 1]))).toEqual({ type: 'unchoke' });
        expect(decodePeerMessage(new Uint8Array([0, 0, 0, 1, 2]))).toEqual({ type: 'interested' });
        expect(decodePeerMessage(new Uint8Array([0, 0, 0, 1, 3]))).toEqual({
            type: 'not-interested',
        });
    });

    test('decodes have', () => {
        expect(decodePeerMessage(new Uint8Array([0, 0, 0, 5, 4, 0, 0, 0, 7]))).toEqual({
            type: 'have',
            pieceIndex: 7,
        });
    });

    test('decodes bitfield without copying payload bytes', () => {
        const input = new Uint8Array([0, 0, 0, 2, 5, 0b10100000]);
        const message = decodePeerMessage(input);

        expect(message).toEqual({ type: 'bitfield', bitfield: new Uint8Array([0b10100000]) });
        expect(message.type === 'bitfield' ? message.bitfield.buffer : undefined).toBe(
            input.buffer,
        );
    });

    test('decodes request', () => {
        expect(
            decodePeerMessage(
                new Uint8Array([0, 0, 0, 13, 6, 0, 0, 0, 7, 0, 0, 64, 0, 0, 0, 64, 0]),
            ),
        ).toEqual({
            type: 'request',
            pieceIndex: 7,
            offset: 16_384,
            length: 16_384,
        });
    });

    test('decodes piece', () => {
        expect(
            decodePeerMessage(new Uint8Array([0, 0, 0, 12, 7, 0, 0, 0, 7, 0, 0, 64, 0, 1, 2, 3])),
        ).toEqual({
            type: 'piece',
            pieceIndex: 7,
            offset: 16_384,
            block: new Uint8Array([1, 2, 3]),
        });
    });

    test('decodes cancel', () => {
        expect(
            decodePeerMessage(
                new Uint8Array([0, 0, 0, 13, 8, 0, 0, 0, 7, 0, 0, 64, 0, 0, 0, 64, 0]),
            ),
        ).toEqual({
            type: 'cancel',
            pieceIndex: 7,
            offset: 16_384,
            length: 16_384,
        });
    });

    test('rejects missing length prefix', () => {
        expectPeerMessageError(
            () => decodePeerMessage(new Uint8Array([0, 0, 0])),
            PeerMessageErrorCode.INVALID_LENGTH_PREFIX,
        );
    });

    test('rejects mismatched message length', () => {
        expectPeerMessageError(
            () => decodePeerMessage(new Uint8Array([0, 0, 0, 2, 5])),
            PeerMessageErrorCode.INVALID_MESSAGE_LENGTH,
        );
    });

    test('rejects invalid fixed payload length', () => {
        expectPeerMessageError(
            () => decodePeerMessage(new Uint8Array([0, 0, 0, 2, 0, 1])),
            PeerMessageErrorCode.INVALID_PAYLOAD_LENGTH,
        );
    });

    test('rejects piece payload shorter than index and offset', () => {
        expectPeerMessageError(
            () => decodePeerMessage(new Uint8Array([0, 0, 0, 8, 7, 0, 0, 0, 7, 0, 0, 64])),
            PeerMessageErrorCode.INVALID_PAYLOAD_LENGTH,
        );
    });

    test('rejects unknown message id', () => {
        expectPeerMessageError(
            () => decodePeerMessage(new Uint8Array([0, 0, 0, 1, 99])),
            PeerMessageErrorCode.UNKNOWN_MESSAGE_ID,
        );
    });

    test('roundtrips payload messages', () => {
        const messages = [
            { type: 'have', pieceIndex: 7 },
            { type: 'bitfield', bitfield: new Uint8Array([0b10100000]) },
            { type: 'request', pieceIndex: 7, offset: 16_384, length: 16_384 },
            { type: 'piece', pieceIndex: 7, offset: 16_384, block: new Uint8Array([1, 2, 3]) },
            { type: 'cancel', pieceIndex: 7, offset: 16_384, length: 16_384 },
        ] as const;

        for (const message of messages) {
            expect(decodePeerMessage(encodePeerMessage(message))).toEqual(message);
        }
    });
});
