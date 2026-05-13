type ByteArray = Uint8Array<ArrayBufferLike>;

export const concatBytes = (parts: ByteArray[]): Uint8Array => {
    const length = parts.reduce((total, part) => total + part.byteLength, 0);
    const output = new Uint8Array(length);

    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.byteLength;
    }

    return output;
};

export const compareBytes = (left: ByteArray, right: ByteArray): number => {
    const length = Math.min(left.byteLength, right.byteLength);

    for (let i = 0; i < length; i++) {
        const diff = left[i]! - right[i]!;
        if (diff !== 0) return diff;
    }

    return left.byteLength - right.byteLength;
};

export const bytesToHex = (bytes: ByteArray): string =>
    [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
