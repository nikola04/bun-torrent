import { describe, expect, test } from 'bun:test';

import { encodeBencode, toBValue } from '..';

const textDecoder = new TextDecoder();

const text = (value: Uint8Array): string => textDecoder.decode(value);

describe('encodeBencode happy path', () => {
    test('encodes a torrent-shaped metadata dictionary from convenience input', () => {
        const value = toBValue({
            announce: 'https://tracker.test/announce',
            info: {
                length: 12345,
                name: 'file.bin',
                'piece length': 16384,
            },
        });

        expect(text(encodeBencode(value))).toBe(
            'd8:announce29:https://tracker.test/announce4:infod6:lengthi12345e4:name8:file.bin12:piece lengthi16384eee',
        );
    });
});
