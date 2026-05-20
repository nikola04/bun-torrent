import { DHTError, DHTErrorCode } from "../errors";

export const DHT_ID_LENGTH = 20;

export const createDhtNodeId = (): Uint8Array => {
    const id = new Uint8Array(20);
    crypto.getRandomValues(id)
    return id;
}

export const isDhtId = (value: Uint8Array): boolean => value.byteLength === DHT_ID_LENGTH;

export const xorDistance = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    if (a.byteLength !== b.byteLength) throw new DHTError(DHTErrorCode.DISTANCE_INVALID_LENGTHS, 'Lengths of bytes to compare are not same')
    return a.map((byte, i) => byte ^ b[i]!);
}

export const compareDistance = (leftId: Uint8Array, rightId: Uint8Array, target: Uint8Array): number => {
    const left = xorDistance(leftId, target);
    const right = xorDistance(rightId, target);

    for (let i = 0; i < left.byteLength; i++) {
        const diff = left[i]! - right[i]!
        if (diff !== 0) return diff;
    }
    return 0;
}
