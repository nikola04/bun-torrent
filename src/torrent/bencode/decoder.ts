import { BencodeDecodeError, BencodeDecodeErrorCode } from './decoder.error';
import { FLAG, type BInteger, type BValue } from './types';

export const decodeBencode = (input: Uint8Array): BValue => {
    const decoder = createDecoder({ input });
    return decoder.decode();
};

const createDecoder = ({ input }: { input: Uint8Array }) => {
    const buffer = input;
    let offset = 0;

    const hasRemainingData = (): boolean => offset < buffer.length;
    const hasNextChar = (): boolean => offset + 1 < buffer.length;

    const char = (): number => {
        if (!hasRemainingData()) fail(BencodeDecodeErrorCode.BUFFER_OVERFLOW, 'Buffer overflow');
        return buffer[offset]!;
    };

    const nextChar = (): number => {
        if (!hasNextChar()) fail(BencodeDecodeErrorCode.BUFFER_OVERFLOW, 'Buffer overflow');
        return buffer[offset + 1]!;
    };

    const readInteger = (): BInteger => {
        if (char() !== FLAG.INTEGER)
            fail(BencodeDecodeErrorCode.EXPECTED_INTEGER, 'Not bencode Integer');
        offset++;

        const sign = char() === FLAG.MINUS ? -1 : 1;
        if (sign === -1) offset++;

        if (!isInteger(char()))
            fail(BencodeDecodeErrorCode.MISSING_INTEGER_DIGITS, 'Missing Integer digits');
        if (char() === 0x30 && hasNextChar() && isInteger(nextChar()))
            fail(BencodeDecodeErrorCode.LEADING_ZERO, 'Leading zeroes not allowed');

        let integer = 0;
        while (hasRemainingData() && isInteger(char())) {
            const digit = char() - 0x30;
            integer = integer * 10 + digit;
            offset++;
        }

        if (!hasRemainingData() || char() !== FLAG.END)
            fail(
                BencodeDecodeErrorCode.UNTERMINATED_INTEGER,
                "Bencode Integer did not end with 'e'",
            );
        offset++;

        if (sign === -1 && integer === 0)
            fail(BencodeDecodeErrorCode.NEGATIVE_ZERO, 'Bencode Integer cannot be -0');

        return integer * sign;
    };

    // const readBytes = (): Uint8Array => {};

    const decode = (): BValue => {
        const value = char() === FLAG.INTEGER ? readInteger() : undefined;

        if (value === undefined)
            return fail(BencodeDecodeErrorCode.BAD_FORMAT, 'Bad bencode format, failed to decode');

        if (hasRemainingData())
            fail(BencodeDecodeErrorCode.TRAILING_DATA, 'There is excess trailing data');

        return value;
    };

    const fail = (code: BencodeDecodeErrorCode, message: string): never => {
        throw new BencodeDecodeError(code, message, offset);
    };

    return {
        decode,
    };
};

const isInteger = (char: number) => char >= 0x30 && char <= 0x39;
