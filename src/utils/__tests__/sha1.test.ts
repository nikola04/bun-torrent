import { describe, expect, test } from 'bun:test';

import { bytesToHex } from '../buffers';
import { sha1 } from '../sha1';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('sha1', () => {
    test('hashes known test vector', () => {
        expect(bytesToHex(sha1(bytes('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    });

    test('returns 20 bytes', () => {
        expect(sha1(bytes('abc')).byteLength).toBe(20);
    });
});
