import type { BDict, BValue } from './bencode/types';
import { TorrentParseError, TorrentParseErrorCode } from './parser.error';

const textDecoder = new TextDecoder('utf-8', { fatal: true });

export const expectField = (dict: BDict, field: string): BValue => {
    const value = dict.get(field);

    if (value === undefined) {
        return fail(TorrentParseErrorCode.FIELD_MISSING, `Missing field: ${field}`, field);
    }

    return value;
};

export const expectDict = (value: BValue, field: string): BDict => {
    if (value instanceof Map) return value;

    return fail(TorrentParseErrorCode.FIELD_INVALID, `Expected dictionary: ${field}`, field);
};

export const readBytes = (dict: BDict, field: string): Uint8Array => {
    const value = expectField(dict, field);

    if (value instanceof Uint8Array) return value;

    return fail(TorrentParseErrorCode.FIELD_INVALID, `Expected bytes: ${field}`, field);
};

export const readInteger = (dict: BDict, field: string): number => {
    const value = expectField(dict, field);

    if (typeof value === 'number') return value;

    return fail(TorrentParseErrorCode.FIELD_INVALID, `Expected integer: ${field}`, field);
};

export const readText = (dict: BDict, field: string): string => {
    return textDecoder.decode(readBytes(dict, field));
};

export const fail = (code: TorrentParseErrorCode, message: string, field?: string): never => {
    throw new TorrentParseError(code, message, field);
};
