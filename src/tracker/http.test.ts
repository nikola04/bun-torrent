import { describe, expect, test } from 'bun:test';

import { encodeBencode, toBValue } from '../torrent/bencode';
import { parseHttpAnnounceResponse } from './http';
import { TrackerError, TrackerErrorCode } from './tracker.error';

describe('parseHttpAnnounceResponse', () => {
    test('parses compact peers from a tracker response', () => {
        const peers = parseHttpAnnounceResponse(
            encodeBencode(
                toBValue({
                    interval: 1_800,
                    peers: new Uint8Array([127, 0, 0, 1, 0x1a, 0xe1, 10, 0, 0, 2, 0x13, 0x88]),
                }),
            ),
        );

        expect(peers).toEqual([
            { ip: '127.0.0.1', port: 6881 },
            { ip: '10.0.0.2', port: 5000 },
        ]);
    });

    test('rejects tracker failure responses', () => {
        expect(() =>
            parseHttpAnnounceResponse(
                encodeBencode(toBValue({ 'failure reason': 'torrent not registered' })),
            ),
        ).toThrow(TrackerError);
        expect(() =>
            parseHttpAnnounceResponse(
                encodeBencode(toBValue({ 'failure reason': 'torrent not registered' })),
            ),
        ).toThrow('torrent not registered');
    });

    test('rejects malformed compact peer lists', () => {
        expect(() =>
            parseHttpAnnounceResponse(
                encodeBencode(toBValue({ peers: new Uint8Array([127, 0, 0, 1, 0x1a]) })),
            ),
        ).toThrow(TrackerError);

        try {
            parseHttpAnnounceResponse(
                encodeBencode(toBValue({ peers: new Uint8Array([127, 0, 0, 1, 0x1a]) })),
            );
            throw new Error('Expected parseHttpAnnounceResponse to throw');
        } catch (error) {
            expect((error as TrackerError).code).toBe(TrackerErrorCode.HTTP_RESPONSE_INVALID);
        }
    });

    test('rejects empty peer lists as no peers', () => {
        expect(() =>
            parseHttpAnnounceResponse(encodeBencode(toBValue({ peers: new Uint8Array() }))),
        ).toThrow(TrackerError);

        try {
            parseHttpAnnounceResponse(encodeBencode(toBValue({ peers: new Uint8Array() })));
            throw new Error('Expected parseHttpAnnounceResponse to throw');
        } catch (error) {
            expect((error as TrackerError).code).toBe(TrackerErrorCode.NO_PEERS);
        }
    });
});
