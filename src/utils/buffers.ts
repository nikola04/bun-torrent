export const concatBytes = (parts: Uint8Array[]): Uint8Array => {
    const length = parts.reduce((total, part) => total + part.byteLength, 0);
    const output = new Uint8Array(length);

    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.byteLength;
    }

    return output;
};

export const compareBytes = (left: Uint8Array, right: Uint8Array): number => {
    const length = Math.min(left.byteLength, right.byteLength);

    for (let i = 0; i < length; i++) {
        const diff = left[i]! - right[i]!;
        if (diff !== 0) return diff;
    }

    return left.byteLength - right.byteLength;
};
