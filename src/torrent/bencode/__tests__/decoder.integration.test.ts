import { describe, expect, test } from 'bun:test';

import { decodeBencode } from '@torrent/bencode';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const ascii = (value: string): Uint8Array => textEncoder.encode(value);

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
    const length = parts.reduce((total, part) => total + part.byteLength, 0);
    const output = new Uint8Array(length);

    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.byteLength;
    }

    return output;
};

const bencodeBytes = (value: Uint8Array): Uint8Array =>
    concatBytes([ascii(`${value.byteLength}:`), value]);

const bencodeString = (value: string): Uint8Array => bencodeBytes(ascii(value));

const expectBytesText = (value: unknown, expected: string): void => {
    expect(value).toBeInstanceOf(Uint8Array);
    expect(textDecoder.decode(value as Uint8Array)).toBe(expected);
};

describe('decodeBencode torrent-shaped documents', () => {
    test('decodes nested metadata while preserving raw pieces bytes', () => {
        const pieces = new Uint8Array(40);
        for (let i = 0; i < pieces.byteLength; i++) {
            pieces[i] = i;
        }

        const input = concatBytes([
            ascii('d'),
            bencodeString('announce'),
            bencodeString('https://tracker.test/announce'),
            bencodeString('info'),
            ascii('d'),
            bencodeString('length'),
            ascii('i12345e'),
            bencodeString('name'),
            bencodeString('file.bin'),
            bencodeString('piece length'),
            ascii('i16384e'),
            bencodeString('pieces'),
            bencodeBytes(pieces),
            ascii('e'),
            ascii('e'),
        ]);

        const decoded = decodeBencode(input);

        expect(decoded).toBeInstanceOf(Map);

        const root = decoded as Map<string, unknown>;
        expectBytesText(root.get('announce'), 'https://tracker.test/announce');
        expect(root.get('info')).toBeInstanceOf(Map);

        const info = root.get('info') as Map<string, unknown>;
        expect(info.get('length')).toBe(12345);
        expectBytesText(info.get('name'), 'file.bin');
        expect(info.get('piece length')).toBe(16384);
        expect(info.get('pieces')).toBeInstanceOf(Uint8Array);
        expect([...Uint8Array.from(info.get('pieces') as Uint8Array)]).toEqual([...pieces]);
    });
});
