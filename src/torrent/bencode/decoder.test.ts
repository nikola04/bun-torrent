import { describe, expect, test } from 'bun:test';

import { decodeBencode } from '@torrent/bencode';
import { BunTorrentError } from '@utils/errors';
import { BencodeDecodeError, BencodeDecodeErrorCode } from './decoder.error';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const expectDecodeError = (value: string, code: BencodeDecodeErrorCode, offset?: number): void => {
    try {
        decodeBencode(bytes(value));
        throw new Error('Expected decodeBencode to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(BencodeDecodeError);
        expect(error).toBeInstanceOf(BunTorrentError);
        expect((error as BencodeDecodeError).code).toBe(code);

        if (offset !== undefined) {
            expect((error as BencodeDecodeError).offset).toBe(offset);
        }
    }
};

describe('decodeBencode integer', () => {
    test('decodes zero', () => {
        expect(decodeBencode(bytes('i0e'))).toBe(0);
    });

    test('decodes positive integers', () => {
        expect(decodeBencode(bytes('i1e'))).toBe(1);
        expect(decodeBencode(bytes('i42e'))).toBe(42);
        expect(decodeBencode(bytes('i123456789e'))).toBe(123456789);
    });

    test('decodes negative integers', () => {
        expect(decodeBencode(bytes('i-1e'))).toBe(-1);
        expect(decodeBencode(bytes('i-42e'))).toBe(-42);
    });

    test('rejects missing integer digits', () => {
        expectDecodeError('ie', BencodeDecodeErrorCode.MISSING_INTEGER_DIGITS, 1);
        expectDecodeError('i-e', BencodeDecodeErrorCode.MISSING_INTEGER_DIGITS, 2);
    });

    test('rejects negative zero', () => {
        expectDecodeError('i-0e', BencodeDecodeErrorCode.NEGATIVE_ZERO, 4);
    });

    test('rejects leading zeroes', () => {
        expectDecodeError('i03e', BencodeDecodeErrorCode.LEADING_ZERO, 1);
        expectDecodeError('i042e', BencodeDecodeErrorCode.LEADING_ZERO, 1);
    });

    test('rejects unterminated integers', () => {
        expectDecodeError('i42', BencodeDecodeErrorCode.UNTERMINATED_INTEGER, 3);
        expectDecodeError('i-42', BencodeDecodeErrorCode.UNTERMINATED_INTEGER, 4);
        expectDecodeError('i0', BencodeDecodeErrorCode.UNTERMINATED_INTEGER, 2);
        expectDecodeError('i-0', BencodeDecodeErrorCode.UNTERMINATED_INTEGER, 3);
    });

    test('rejects integers outside the JavaScript safe integer range', () => {
        expectDecodeError('i9007199254740992e', BencodeDecodeErrorCode.UNSAFE_INTEGER, 18);
        expectDecodeError('i-9007199254740992e', BencodeDecodeErrorCode.UNSAFE_INTEGER, 19);
    });

    test('rejects trailing data after a root integer', () => {
        expectDecodeError('i42ee', BencodeDecodeErrorCode.TRAILING_DATA, 4);
        expectDecodeError('i42e0:', BencodeDecodeErrorCode.TRAILING_DATA, 4);
    });

    test('rejects unsupported root values with a bencode decode error', () => {
        expectDecodeError('x', BencodeDecodeErrorCode.BAD_FORMAT, 0);
    });
});
