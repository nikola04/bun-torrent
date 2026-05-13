import {
    HANDSHAKE_LENGTH,
    INFO_HASH_LENGTH,
    PEER_ID_LENGTH,
    PROTOCOL,
    PROTOCOL_BYTES,
    RESERVED_LENGTH,
} from './consts';
import { HandshakeErrorCode, PeerHandshakeError } from './handshake.error';
import type { PeerHandshake } from './types';

const textDecoder = new TextDecoder('utf-8', { fatal: true });

export const encodeHandshake = (input: {
    infoHash: Uint8Array;
    peerId: Uint8Array;
    reserved?: Uint8Array;
}): Uint8Array => {
    if (input.infoHash.byteLength !== INFO_HASH_LENGTH)
        return fail(
            HandshakeErrorCode.INFOHASH_INVALID_LENGTH,
            'Torrent infohash is invalid length',
        );
    if (input.peerId.byteLength !== PEER_ID_LENGTH)
        return fail(HandshakeErrorCode.PEERID_INVALID_LENGTH, 'Torrent peerId is invalid length');

    let offset = 0;
    const handshake = new Uint8Array(HANDSHAKE_LENGTH);

    handshake[offset++] = PROTOCOL_BYTES.byteLength;
    handshake.set(PROTOCOL_BYTES, offset);
    offset += PROTOCOL_BYTES.byteLength;

    const reserved = input.reserved ?? new Uint8Array(RESERVED_LENGTH);
    if (reserved.byteLength !== RESERVED_LENGTH)
        return fail(
            HandshakeErrorCode.RESERVED_INVALID_LENGTH,
            'Handshake reserved is invalid length',
        );

    handshake.set(reserved, offset);
    offset += RESERVED_LENGTH;

    handshake.set(input.infoHash, offset);
    offset += INFO_HASH_LENGTH;

    handshake.set(input.peerId, offset);

    return handshake;
};

export const decodeHandshake = (handshake: Uint8Array): PeerHandshake => {
    if (handshake.byteLength !== HANDSHAKE_LENGTH)
        return fail(HandshakeErrorCode.INVALID_LENGTH, 'Handshake is invalid length');

    let offset = 0;
    const protocolLength = handshake[offset++]!;
    const protocolEnd = offset + protocolLength;
    const protocol = textDecoder.decode(handshake.subarray(offset, protocolEnd));
    offset = protocolEnd;

    if (protocol !== PROTOCOL)
        return fail(HandshakeErrorCode.INVALID_PROTOCOL, 'Handshake protocol is invalid');

    const reserved = handshake.subarray(offset, offset + RESERVED_LENGTH);
    offset += RESERVED_LENGTH;

    const infoHash = handshake.subarray(offset, offset + INFO_HASH_LENGTH);
    offset += INFO_HASH_LENGTH;

    const peerId = handshake.subarray(offset, offset + PEER_ID_LENGTH);

    return {
        protocol,
        reserved,
        infoHash,
        peerId,
    };
};

const fail = (code: HandshakeErrorCode, message: string): never => {
    throw new PeerHandshakeError(code, message);
};
