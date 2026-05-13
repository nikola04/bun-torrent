import { describe, expect, test } from 'bun:test';

import { encodeBencode } from '@torrent/bencode';
import { BunTorrentError } from '@utils/errors';
import { BencodeEncodeError, BencodeEncodeErrorCode } from '../encoder.error';
import type { BValue } from '../types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const bytes = (value: string): Uint8Array => textEncoder.encode(value);
const text = (value: Uint8Array): string => textDecoder.decode(value);

const expectEncoded = (value: Parameters<typeof encodeBencode>[0], expected: string): void => {
    expect(text(encodeBencode(value))).toBe(expected);
};

const expectEncodeError = (value: unknown, code: BencodeEncodeErrorCode): void => {
    try {
        encodeBencode(value as BValue);
        throw new Error('Expected encodeBencode to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(BencodeEncodeError);
        expect(error).toBeInstanceOf(BunTorrentError);
        expect((error as BencodeEncodeError).code).toBe(code);
    }
};

describe('encodeBencode integer', () => {
    test('encodes zero', () => {
        expectEncoded(0, 'i0e');
    });

    test('encodes positive integers', () => {
        expectEncoded(1, 'i1e');
        expectEncoded(42, 'i42e');
        expectEncoded(123456789, 'i123456789e');
    });

    test('encodes negative integers', () => {
        expectEncoded(-1, 'i-1e');
        expectEncoded(-42, 'i-42e');
    });

    test('rejects negative zero', () => {
        expectEncodeError(-0, BencodeEncodeErrorCode.NEGATIVE_ZERO);
    });

    test('rejects unsafe integers', () => {
        expectEncodeError(Number.MAX_SAFE_INTEGER + 1, BencodeEncodeErrorCode.UNSAFE_INTEGER);
        expectEncodeError(Number.MIN_SAFE_INTEGER - 1, BencodeEncodeErrorCode.UNSAFE_INTEGER);
    });

    test('rejects invalid integer numbers', () => {
        expectEncodeError(1.5, BencodeEncodeErrorCode.INVALID_INTEGER);
        expectEncodeError(Number.NaN, BencodeEncodeErrorCode.INVALID_INTEGER);
        expectEncodeError(Number.POSITIVE_INFINITY, BencodeEncodeErrorCode.INVALID_INTEGER);
        expectEncodeError(Number.NEGATIVE_INFINITY, BencodeEncodeErrorCode.INVALID_INTEGER);
    });
});

describe('encodeBencode bytes', () => {
    test('encodes empty bytes', () => {
        expectEncoded(new Uint8Array(), '0:');
    });

    test('encodes byte strings', () => {
        expectEncoded(bytes('spam'), '4:spam');
        expectEncoded(bytes('hello world'), '11:hello world');
    });

    test('preserves raw binary bytes', () => {
        const encoded = encodeBencode(new Uint8Array([0x00, 0xff, 0x69, 0x65]));

        expect([...encoded]).toEqual([0x34, 0x3a, 0x00, 0xff, 0x69, 0x65]);
    });
});

describe('encodeBencode unsupported values', () => {
    test('rejects unsupported runtime values', () => {
        expectEncodeError('spam', BencodeEncodeErrorCode.UNSUPPORTED_VALUE);
        expectEncodeError(null, BencodeEncodeErrorCode.UNSUPPORTED_VALUE);
        expectEncodeError(undefined, BencodeEncodeErrorCode.UNSUPPORTED_VALUE);
        expectEncodeError({ value: 1 }, BencodeEncodeErrorCode.UNSUPPORTED_VALUE);
        expectEncodeError(true, BencodeEncodeErrorCode.UNSUPPORTED_VALUE);
    });
});

describe('encodeBencode list', () => {
    test('encodes empty lists', () => {
        expectEncoded([], 'le');
    });

    test('encodes lists with mixed values', () => {
        expectEncoded([bytes('spam'), 42], 'l4:spami42ee');
    });

    test('encodes nested lists', () => {
        expectEncoded([[1, 2], bytes('foo')], 'lli1ei2ee3:fooe');
    });
});

describe('encodeBencode dictionary', () => {
    test('encodes empty dictionaries', () => {
        expectEncoded(new Map(), 'de');
    });

    test('encodes dictionaries with mixed values', () => {
        expectEncoded(
            new Map<string, BValue>([
                ['foo', bytes('bar')],
                ['num', 42],
            ]),
            'd3:foo3:bar3:numi42ee',
        );
    });

    test('sorts dictionary keys by byte order', () => {
        expectEncoded(
            new Map<string, BValue>([
                ['spam', bytes('eggs')],
                ['bar', bytes('baz')],
                ['foo', 42],
            ]),
            'd3:bar3:baz3:fooi42e4:spam4:eggse',
        );
    });

    test('encodes nested dictionaries and lists', () => {
        expectEncoded(
            new Map<string, BValue>([
                ['dict', new Map<string, BValue>([['key', bytes('value')]])],
                ['list', [1, bytes('two')]],
            ]),
            'd4:dictd3:key5:valuee4:listli1e3:twoee',
        );
    });
});
