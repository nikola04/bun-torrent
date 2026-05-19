import { Base32DecoderError, Base32DecoderErrorCode } from './errors';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const decodeBase32 = (str: string): Uint8Array => {
    const base32 = str.toUpperCase().replace(/=+$/, '');

    let bits = 0;
    let value = 0;
    let index = 0;
    const output = new Uint8Array(Math.floor((base32.length * 5) / 8));

    for (const char of base32) {
        const charIndex = BASE32_ALPHABET.indexOf(char);
        if (charIndex === -1) {
            throw new Base32DecoderError(
                Base32DecoderErrorCode.INVALID_CHAR,
                `Invalid base32 character: ${char}`,
            );
        }

        value = (value << 5) | charIndex;
        bits += 5;

        if (bits >= 8) {
            output[index++] = (value >> (bits - 8)) & 0xff;
            bits -= 8;
        }
    }

    return output;
};

export { Base32DecoderError, Base32DecoderErrorCode };
