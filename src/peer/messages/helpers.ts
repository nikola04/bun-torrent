import { concatBytes } from '@utils/buffers';
import { PeerMessageError, PeerMessageErrorCode } from './error';
import type { PeerMessageId } from './types';

const UINT32_MAX = 0xffffffff;

export const encodeFrame = (
    id: PeerMessageId,
    payload: Uint8Array<ArrayBufferLike> = new Uint8Array(),
): Uint8Array => concatBytes([writeUInt32(1 + payload.byteLength), new Uint8Array([id]), payload]);

export const writeUInt32 = (value: number): Uint8Array => {
    assertUInt32(value);

    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    return bytes;
};

export const readUInt32 = (input: Uint8Array, offset: number): number => {
    if (offset < 0 || offset + 4 > input.byteLength) {
        return fail(PeerMessageErrorCode.INVALID_LENGTH_PREFIX, 'Not enough bytes to read uint32');
    }

    return new DataView(input.buffer, input.byteOffset + offset, 4).getUint32(0, false);
};

export const assertUInt32 = (value: number): void => {
    if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
        return fail(PeerMessageErrorCode.INVALID_UINT32, `Invalid uint32: ${value}`);
    }
};

const fail = (code: PeerMessageErrorCode, message: string): never => {
    throw new PeerMessageError(code, message);
};
