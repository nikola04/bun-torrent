import { compareBytes, concatBytes } from '@utils/buffers';
import { BencodeEncodeError, BencodeEncodeErrorCode } from './encoder.error';
import { FLAG, type BValue } from './types';

export const encodeBencode = (input: BValue): Uint8Array => {
    const encoder = createEncoder({ input });
    return encoder.encode();
};

const IDENTIFIERS = {
    integer: new Uint8Array([FLAG.INTEGER]),
    delimiter: new Uint8Array([FLAG.STR_DELIMITER]),
    list: new Uint8Array([FLAG.LIST]),
    dictionary: new Uint8Array([FLAG.DICTIONARY]),
    end: new Uint8Array([FLAG.END]),
} as const;

const createEncoder = ({ input }: { input: BValue }) => {
    const textEncoder = new TextEncoder('utf-8');
    const buffer: Array<Uint8Array> = [];

    const pushAscii = (value: string): void => {
        buffer.push(textEncoder.encode(value));
    };

    const encodeInteger = (value: number): void => {
        if (!Number.isInteger(value))
            fail(BencodeEncodeErrorCode.INVALID_INTEGER, 'Bencode integer must be an integer');
        if (!Number.isSafeInteger(value))
            fail(BencodeEncodeErrorCode.UNSAFE_INTEGER, 'Bencode integer must be safe');
        if (Object.is(value, -0))
            fail(BencodeEncodeErrorCode.NEGATIVE_ZERO, 'Bencode integer cannot be -0');

        buffer.push(IDENTIFIERS.integer);
        pushAscii(String(value));
        buffer.push(IDENTIFIERS.end);
    };

    const encodeBytes = (data: Uint8Array): void => {
        pushAscii(String(data.byteLength));
        buffer.push(IDENTIFIERS.delimiter, data);
    };

    const encodeList = (list: BValue[]): void => {
        buffer.push(IDENTIFIERS.list);
        for (const value of list) {
            encodeValue(value);
        }
        buffer.push(IDENTIFIERS.end);
    };

    const encodeDictionary = (dict: Map<string, BValue>): void => {
        buffer.push(IDENTIFIERS.dictionary);

        const entries = [...dict.entries()].sort(([left], [right]) =>
            compareBytes(textEncoder.encode(left), textEncoder.encode(right)),
        );

        for (const [key, value] of entries) {
            encodeBytes(textEncoder.encode(key));
            encodeValue(value);
        }

        buffer.push(IDENTIFIERS.end);
    };

    const encodeValue = (value: BValue): void => {
        if (typeof value === 'number') return encodeInteger(value);
        if (value instanceof Uint8Array) return encodeBytes(value);
        if (Array.isArray(value)) return encodeList(value);
        if (value instanceof Map) return encodeDictionary(value);

        return fail(BencodeEncodeErrorCode.UNSUPPORTED_VALUE, 'Unsupported bencode value');
    };

    const encode = (): Uint8Array => {
        encodeValue(input);
        return concatBytes(buffer);
    };

    const fail = (code: BencodeEncodeErrorCode, message: string): never => {
        throw new BencodeEncodeError(code, message);
    };

    return { encode };
};
