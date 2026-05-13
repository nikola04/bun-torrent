import { describe, expect, test } from 'bun:test';

import { BunTorrentError } from '@utils/errors';
import {
    HANDSHAKE_LENGTH,
    INFO_HASH_LENGTH,
    PEER_ID_LENGTH,
    PROTOCOL,
    PROTOCOL_BYTES,
    RESERVED_LENGTH,
} from '../consts';
import { decodeHandshake, encodeHandshake } from '../handshake/handshake';
import { HandshakeErrorCode, PeerHandshakeError } from '../handshake/handshake.error';

const makeBytes = (length: number, start = 0): Uint8Array => {
    const bytes = new Uint8Array(length);

    for (let i = 0; i < length; i++) {
        bytes[i] = start + i;
    }

    return bytes;
};

const expectHandshakeError = (callback: () => unknown, code: HandshakeErrorCode): void => {
    try {
        callback();
        throw new Error('Expected handshake operation to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(PeerHandshakeError);
        expect(error).toBeInstanceOf(BunTorrentError);
        expect((error as PeerHandshakeError).code).toBe(code);
    }
};

describe('encodeHandshake', () => {
    test('encodes a 68-byte BitTorrent handshake', () => {
        const infoHash = makeBytes(INFO_HASH_LENGTH, 1);
        const peerId = makeBytes(PEER_ID_LENGTH, 101);
        const handshake = encodeHandshake({ infoHash, peerId });

        expect(handshake.byteLength).toBe(HANDSHAKE_LENGTH);
        expect(handshake[0]).toBe(PROTOCOL_BYTES.byteLength);
        expect([...handshake.subarray(1, 20)]).toEqual([...PROTOCOL_BYTES]);
        expect([...handshake.subarray(20, 28)]).toEqual([...new Uint8Array(RESERVED_LENGTH)]);
        expect([...handshake.subarray(28, 48)]).toEqual([...infoHash]);
        expect([...handshake.subarray(48, 68)]).toEqual([...peerId]);
    });

    test('encodes custom reserved bytes', () => {
        const reserved = makeBytes(RESERVED_LENGTH, 201);
        const handshake = encodeHandshake({
            infoHash: makeBytes(INFO_HASH_LENGTH, 1),
            peerId: makeBytes(PEER_ID_LENGTH, 101),
            reserved,
        });

        expect([...handshake.subarray(20, 28)]).toEqual([...reserved]);
    });

    test('rejects invalid info hash length', () => {
        expectHandshakeError(
            () =>
                encodeHandshake({
                    infoHash: new Uint8Array(19),
                    peerId: makeBytes(PEER_ID_LENGTH),
                }),
            HandshakeErrorCode.INFOHASH_INVALID_LENGTH,
        );
    });

    test('rejects invalid peer id length', () => {
        expectHandshakeError(
            () =>
                encodeHandshake({
                    infoHash: makeBytes(INFO_HASH_LENGTH),
                    peerId: new Uint8Array(19),
                }),
            HandshakeErrorCode.PEERID_INVALID_LENGTH,
        );
    });

    test('rejects invalid reserved length', () => {
        expectHandshakeError(
            () =>
                encodeHandshake({
                    infoHash: makeBytes(INFO_HASH_LENGTH),
                    peerId: makeBytes(PEER_ID_LENGTH),
                    reserved: new Uint8Array(7),
                }),
            HandshakeErrorCode.RESERVED_INVALID_LENGTH,
        );
    });
});

describe('decodeHandshake', () => {
    test('decodes an encoded handshake', () => {
        const infoHash = makeBytes(INFO_HASH_LENGTH, 1);
        const peerId = makeBytes(PEER_ID_LENGTH, 101);
        const reserved = makeBytes(RESERVED_LENGTH, 201);
        const decoded = decodeHandshake(encodeHandshake({ infoHash, peerId, reserved }));

        expect(decoded.protocol).toBe(PROTOCOL);
        expect([...decoded.reserved]).toEqual([...reserved]);
        expect([...decoded.infoHash]).toEqual([...infoHash]);
        expect([...decoded.peerId]).toEqual([...peerId]);
    });

    test('rejects invalid handshake length', () => {
        expectHandshakeError(
            () => decodeHandshake(new Uint8Array(HANDSHAKE_LENGTH - 1)),
            HandshakeErrorCode.INVALID_LENGTH,
        );
    });

    test('rejects invalid protocol', () => {
        const handshake = encodeHandshake({
            infoHash: makeBytes(INFO_HASH_LENGTH),
            peerId: makeBytes(PEER_ID_LENGTH),
        });
        handshake[1] = 0x78;

        expectHandshakeError(() => decodeHandshake(handshake), HandshakeErrorCode.INVALID_PROTOCOL);
    });
});
