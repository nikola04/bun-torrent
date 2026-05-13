import { BencodeDecodeError, BencodeDecodeErrorCode } from './decoder.error';
import { FLAG, type BDict, type BInteger, type BValue } from './types';

export const decodeBencode = (input: Uint8Array): BValue => {
    const decoder = createDecoder({ input });
    return decoder.decode();
};

const createDecoder = ({
    input,
    strict = true,
    maxBytesLength = 1024 * 1024,
}: {
    input: Uint8Array;
    strict?: boolean;
    maxBytesLength?: number;
}) => {
    const textDecoder = new TextDecoder('utf-8', { fatal: strict });
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

    const readNumber = (): number => {
        if (char() === 0x30 && hasNextChar() && isDigit(nextChar()))
            fail(BencodeDecodeErrorCode.LEADING_ZERO, 'Leading zeroes not allowed');

        let integer = 0;
        while (hasRemainingData() && isDigit(char())) {
            const digit = char() - 0x30;
            integer = integer * 10 + digit;
            offset++;
        }

        return integer;
    };

    const checkNumber = (integer: number): void | never => {
        if (Number.isSafeInteger(integer)) return;
        return fail(BencodeDecodeErrorCode.UNSAFE_INTEGER, 'Decoded Integer is not safe');
    };

    const readInteger = (): BInteger => {
        if (char() !== FLAG.INTEGER)
            fail(BencodeDecodeErrorCode.EXPECTED_INTEGER, 'Not bencode Integer');
        offset++;

        const sign = char() === FLAG.MINUS ? -1 : 1;
        if (sign === -1) offset++;

        if (!isDigit(char()))
            fail(BencodeDecodeErrorCode.MISSING_INTEGER_DIGITS, 'Missing Integer digits');

        const integer = readNumber();

        if (!hasRemainingData() || char() !== FLAG.END)
            fail(
                BencodeDecodeErrorCode.UNTERMINATED_INTEGER,
                "Bencode Integer did not end with 'e'",
            );
        offset++;

        if (sign === -1 && integer === 0)
            fail(BencodeDecodeErrorCode.NEGATIVE_ZERO, 'Bencode Integer cannot be -0');

        const result = integer * sign;
        checkNumber(result);

        return result;
    };

    const readBytes = (): Uint8Array => {
        if (!isDigit(char()))
            fail(BencodeDecodeErrorCode.EXPECTED_DIGIT, 'Not digit, failed to read length');

        const length = readNumber();
        checkNumber(length);

        if (length > maxBytesLength)
            fail(
                BencodeDecodeErrorCode.MAX_SIZE_EXCEEDED,
                `Bytes max size exceeded (${length}:${maxBytesLength})`,
            );

        if (!hasRemainingData() || char() !== FLAG.STR_DELIMITER)
            fail(BencodeDecodeErrorCode.EXPECTED_DELIM, 'Bytes failed, expected delimiter');
        offset++;

        const start = offset,
            end = offset + length;
        if (end > buffer.length) fail(BencodeDecodeErrorCode.BUFFER_OVERFLOW, 'Buffer overflow');

        offset = end;
        return buffer.subarray(start, end);
    };

    const readList = (): Array<BValue> => {
        if (char() !== FLAG.LIST)
            fail(BencodeDecodeErrorCode.EXPECTED_LIST_FLAG, 'Not bencode list flag');
        offset++;

        const list: BValue[] = [];
        while (hasRemainingData()) {
            if (char() === FLAG.END) {
                offset++;
                return list;
            }
            list.push(readValue());
        }

        return fail(BencodeDecodeErrorCode.UNTERMINATED_LIST, "Bencode list did not end with 'e'");
    };

    const readDictionary = (): BDict => {
        if (char() !== FLAG.DICTIONARY)
            fail(BencodeDecodeErrorCode.EXPECTED_DICT_FLAG, 'Not bencode dictionary flag');
        offset++;

        const dict: BDict = new Map<string, BValue>();

        while (hasRemainingData()) {
            if (char() === FLAG.END) {
                offset++;
                return dict;
            }
            const key = textDecoder.decode(readBytes());
            if (dict.has(key))
                fail(BencodeDecodeErrorCode.DUPLICATE_KEY, 'Duplicate bencode dictionary key');

            const value = readValue();
            dict.set(key, value);
        }

        return fail(
            BencodeDecodeErrorCode.UNTERMINATED_DICT,
            "Bencode dictionary did not end with 'e'",
        );
    };

    const readValue = (): BValue => {
        const current = char();

        if (current === FLAG.INTEGER) return readInteger();
        if (isDigit(current)) return readBytes();
        if (current === FLAG.LIST) return readList();
        if (current === FLAG.DICTIONARY) return readDictionary();

        return fail(BencodeDecodeErrorCode.BAD_FORMAT, 'Bad bencode format, failed to decode');
    };

    const decode = (): BValue => {
        const value = readValue();

        if (hasRemainingData())
            return fail(BencodeDecodeErrorCode.TRAILING_DATA, 'There is excess trailing data');

        return value;
    };

    const fail = (code: BencodeDecodeErrorCode, message: string): never => {
        throw new BencodeDecodeError(code, message, offset);
    };

    return {
        decode,
    };
};

const isDigit = (char: number) => char >= 0x30 && char <= 0x39;
