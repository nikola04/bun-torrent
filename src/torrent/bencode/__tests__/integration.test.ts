import { describe, expect, test } from 'bun:test';

import { decodeBencode, encodeBencode, toBValue } from '..';

const textDecoder = new TextDecoder();

const expectBytesText = (value: unknown, expected: string): void => {
    expect(value).toBeInstanceOf(Uint8Array);
    expect(textDecoder.decode(value as Uint8Array)).toBe(expected);
};

describe('bencode integration', () => {
    test('round trips empty containers', () => {
        const decoded = decodeBencode(encodeBencode(toBValue({ emptyDict: {}, emptyList: [] })));

        expect(decoded).toBeInstanceOf(Map);

        const root = decoded as Map<string, unknown>;
        expect(root.get('emptyDict')).toBeInstanceOf(Map);
        expect((root.get('emptyDict') as Map<string, unknown>).size).toBe(0);
        expect(root.get('emptyList')).toEqual([]);
    });

    test('round trips a torrent-shaped value with every bencode type', () => {
        const pieces = new Uint8Array(40);
        for (let i = 0; i < pieces.byteLength; i++) {
            pieces[i] = i;
        }

        const value = toBValue({
            announce: 'https://tracker.test/announce',
            'announce-list': [
                ['https://tracker-a.test/announce'],
                ['https://tracker-b.test/announce'],
            ],
            info: {
                length: 12345,
                name: 'file.bin',
                'piece length': 16384,
                pieces,
            },
        });

        const decoded = decodeBencode(encodeBencode(value));

        expect(decoded).toBeInstanceOf(Map);

        const root = decoded as Map<string, unknown>;
        expectBytesText(root.get('announce'), 'https://tracker.test/announce');

        const announceList = root.get('announce-list') as unknown[];
        expect(Array.isArray(announceList)).toBe(true);
        expectBytesText((announceList[0] as unknown[])[0], 'https://tracker-a.test/announce');
        expectBytesText((announceList[1] as unknown[])[0], 'https://tracker-b.test/announce');

        const info = root.get('info') as Map<string, unknown>;
        expect(info).toBeInstanceOf(Map);
        expect(info.get('length')).toBe(12345);
        expectBytesText(info.get('name'), 'file.bin');
        expect(info.get('piece length')).toBe(16384);
        expect(info.get('pieces')).toBeInstanceOf(Uint8Array);
        expect([...Uint8Array.from(info.get('pieces') as Uint8Array)]).toEqual([...pieces]);
    });
});
