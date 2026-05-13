import { PeerMessageError, PeerMessageErrorCode } from './error';
import { encodeFrame, writeUInt32 } from './helpers';
import { PeerMessageId, type PeerMessage } from './types';
import { concatBytes } from '@utils/buffers';

export const encodePeerMessage = (message: PeerMessage): Uint8Array => {
    switch (message.type) {
        case 'keep-alive':
            return writeUInt32(0);
        case 'choke':
            return encodeFrame(PeerMessageId.Choke);
        case 'unchoke':
            return encodeFrame(PeerMessageId.Unchoke);
        case 'interested':
            return encodeFrame(PeerMessageId.Interested);
        case 'not-interested':
            return encodeFrame(PeerMessageId.NotInterested);
        case 'have':
            return encodeFrame(PeerMessageId.Have, writeUInt32(message.pieceIndex));
        case 'bitfield':
            return encodeFrame(PeerMessageId.Bitfield, message.bitfield);
        case 'request':
            return encodeFrame(
                PeerMessageId.Request,
                concatBytes([
                    writeUInt32(message.pieceIndex),
                    writeUInt32(message.offset),
                    writeUInt32(message.length),
                ]),
            );
        case 'piece':
            return encodeFrame(
                PeerMessageId.Piece,
                concatBytes([
                    writeUInt32(message.pieceIndex),
                    writeUInt32(message.offset),
                    message.block,
                ]),
            );
        case 'cancel':
            return encodeFrame(
                PeerMessageId.Cancel,
                concatBytes([
                    writeUInt32(message.pieceIndex),
                    writeUInt32(message.offset),
                    writeUInt32(message.length),
                ]),
            );
        default:
            return assertNever(message);
    }
};

export const decodePeerMessage = (input: Uint8Array): PeerMessage => {
    if (input.byteLength < 4) {
        return fail(
            PeerMessageErrorCode.INVALID_LENGTH_PREFIX,
            'Peer message is missing length prefix',
        );
    }

    const length = readUInt32(input, 0);
    if (input.byteLength !== 4 + length) {
        return fail(
            PeerMessageErrorCode.INVALID_MESSAGE_LENGTH,
            'Peer message length does not match input size',
        );
    }

    if (length === 0) {
        return { type: 'keep-alive' };
    }

    const id = input[4];
    const payload = input.subarray(5);

    switch (id) {
        case PeerMessageId.Choke:
            assertPayloadLength(payload, 0, 'choke');
            return { type: 'choke' };
        case PeerMessageId.Unchoke:
            assertPayloadLength(payload, 0, 'unchoke');
            return { type: 'unchoke' };
        case PeerMessageId.Interested:
            assertPayloadLength(payload, 0, 'interested');
            return { type: 'interested' };
        case PeerMessageId.NotInterested:
            assertPayloadLength(payload, 0, 'not-interested');
            return { type: 'not-interested' };
        case PeerMessageId.Have:
            assertPayloadLength(payload, 4, 'have');
            return { type: 'have', pieceIndex: readUInt32(payload, 0) };
        case PeerMessageId.Bitfield:
            return { type: 'bitfield', bitfield: payload };
        case PeerMessageId.Request:
            assertPayloadLength(payload, 12, 'request');
            return {
                type: 'request',
                pieceIndex: readUInt32(payload, 0),
                offset: readUInt32(payload, 4),
                length: readUInt32(payload, 8),
            };
        case PeerMessageId.Piece:
            assertMinPayloadLength(payload, 8, 'piece');
            return {
                type: 'piece',
                pieceIndex: readUInt32(payload, 0),
                offset: readUInt32(payload, 4),
                block: payload.subarray(8),
            };
        case PeerMessageId.Cancel:
            assertPayloadLength(payload, 12, 'cancel');
            return {
                type: 'cancel',
                pieceIndex: readUInt32(payload, 0),
                offset: readUInt32(payload, 4),
                length: readUInt32(payload, 8),
            };
        default:
            return fail(PeerMessageErrorCode.UNKNOWN_MESSAGE_ID, `Unknown peer message id: ${id}`);
    }
};

export { PeerMessageError, PeerMessageErrorCode } from './error';
export { PeerMessageId } from './types';
export type {
    BitfieldMessage,
    CancelMessage,
    ChokeMessage,
    HaveMessage,
    InterestedMessage,
    KeepAliveMessage,
    NotInterestedMessage,
    PeerMessage,
    PieceMessage,
    RequestMessage,
    UnchokeMessage,
} from './types';

const readUInt32 = (input: Uint8Array, offset: number): number => {
    if (offset < 0 || offset + 4 > input.byteLength) {
        return fail(
            PeerMessageErrorCode.INVALID_PAYLOAD_LENGTH,
            'Not enough payload bytes to read uint32',
        );
    }

    return new DataView(input.buffer, input.byteOffset + offset, 4).getUint32(0, false);
};

const assertPayloadLength = (payload: Uint8Array, expected: number, type: string): void => {
    if (payload.byteLength !== expected) {
        return fail(
            PeerMessageErrorCode.INVALID_PAYLOAD_LENGTH,
            `${type} payload must be ${expected} bytes, got ${payload.byteLength}`,
        );
    }
};

const assertMinPayloadLength = (payload: Uint8Array, minimum: number, type: string): void => {
    if (payload.byteLength < minimum) {
        return fail(
            PeerMessageErrorCode.INVALID_PAYLOAD_LENGTH,
            `${type} payload must be at least ${minimum} bytes, got ${payload.byteLength}`,
        );
    }
};

const assertNever = (value: never): never =>
    fail(PeerMessageErrorCode.UNSUPPORTED_MESSAGE, `Unsupported peer message: ${String(value)}`);

const fail = (code: PeerMessageErrorCode, message: string): never => {
    throw new PeerMessageError(code, message);
};
