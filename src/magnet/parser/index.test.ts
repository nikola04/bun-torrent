import { describe, expect, test } from 'bun:test';

import { bytesToHex } from '../../utils/buffers';
import { MagnetParseError, MagnetParseErrorCode, parseMagnet, parseMagnetURI } from '.';

const hexInfoHash = '0123456789abcdef0123456789abcdef01234567';

describe('parseMagnetURI', () => {
    test('parses hex btih magnets with display name and trackers', () => {
        const parsed = parseMagnetURI(
            `magnet:?xt=urn:btih:${hexInfoHash}&dn=file.bin&tr=udp%3A%2F%2Ftracker-a.test%3A80%2Fannounce&tr=https%3A%2F%2Ftracker-b.test%2Fannounce`,
        );

        expect(bytesToHex(parsed.infoHash)).toBe(hexInfoHash);
        expect(parsed.name).toBe('file.bin');
        expect(parsed.trackers).toEqual([
            'udp://tracker-a.test:80/announce',
            'https://tracker-b.test/announce',
        ]);
    });

    test('parses base32 btih magnets', () => {
        const parsed = parseMagnetURI(`magnet:?xt=urn:btih:${'A'.repeat(32)}`);

        expect(parsed.infoHash).toEqual(new Uint8Array(20));
    });

    test('rejects non-magnet URIs', () => {
        expect(() => parseMagnetURI(`https://example.test/?xt=urn:btih:${hexInfoHash}`)).toThrow(
            MagnetParseError,
        );

        try {
            parseMagnetURI('not a uri');
        } catch (error) {
            expect((error as MagnetParseError).code).toBe(MagnetParseErrorCode.INVALID_URI);
        }
    });

    test('rejects missing or invalid xt values', () => {
        expect(() => parseMagnetURI('magnet:?dn=file.bin')).toThrow(MagnetParseError);

        try {
            parseMagnetURI(`magnet:?xt=urn:btih:${'z'.repeat(40)}`);
        } catch (error) {
            expect((error as MagnetParseError).code).toBe(MagnetParseErrorCode.INVALID_XT);
        }
    });
});

describe('parseMagnet', () => {
    test('rejects trackerless magnets until DHT is implemented', async () => {
        expect(
            parseMagnet(`magnet:?xt=urn:btih:${hexInfoHash}`, new Uint8Array(20)),
        ).rejects.toMatchObject({
            code: MagnetParseErrorCode.NOT_IMPLEMENTED,
        });
    });
});
