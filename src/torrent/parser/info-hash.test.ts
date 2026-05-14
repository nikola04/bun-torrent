import { describe, expect, test } from 'bun:test';

import { bytesToHex } from '@utils/buffers';
import { toBValue } from '../bencode';
import type { BDict, BValue } from '../bencode/types';
import { computeInfoHash } from './info-hash';

describe('computeInfoHash', () => {
    test('hashes the canonical bencoded info dictionary', () => {
        const info = toBValue({
            length: 12345,
            name: 'file.bin',
            'piece length': 16384,
            pieces: new Uint8Array([0x00, 0xff, 0x69, 0x65]),
        }) as BDict;

        const hashed = 'c3982cffb55c2a39ac33477abbd4932316df786c';

        expect(bytesToHex(computeInfoHash(info))).toBe(hashed);
    });

    test('is stable regardless of dictionary insertion order', () => {
        const pieces = new Uint8Array([0x00, 0xff, 0x69, 0x65]);
        const first = new Map<string, BValue>([
            ['name', new TextEncoder().encode('file.bin')],
            ['length', 12345],
            ['piece length', 16384],
            ['pieces', pieces],
        ]) as BDict;
        const second = new Map<string, BValue>([
            ['pieces', pieces],
            ['piece length', 16384],
            ['length', 12345],
            ['name', new TextEncoder().encode('file.bin')],
        ]) as BDict;

        expect(bytesToHex(computeInfoHash(first))).toBe(bytesToHex(computeInfoHash(second)));
    });
});
