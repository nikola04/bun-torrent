import { describe, expect, test } from 'bun:test';

import { decodePeerMessage } from '../messages';
import { EXTENDED_HANDSHAKE_ID, encodeExtendedHandshake, parseExtendedHandshake } from './protocol';
import { encodeBencode, toBValue } from '../../torrent';
import { PeerExtendedError, PeerExtendedErrorCode } from './errors';

describe('extended protocol helpers', () => {
    test('encodes and parses extended handshakes', () => {
        const message = decodePeerMessage(encodeExtendedHandshake({ ut_metadata: 1, ut_pex: 2 }));

        expect(message.type).toBe('extended');
        if (message.type !== 'extended') return;

        expect(message.extId).toBe(EXTENDED_HANDSHAKE_ID);
        const handshake = parseExtendedHandshake(
            encodeBencode(toBValue({ m: { ut_metadata: 7 }, metadata_size: 12_345 })),
        );

        expect(handshake.extensions).toEqual(new Map([['ut_metadata', 7]]));
        expect(handshake.metadataSize).toBe(12_345);
    });

    test('rejects malformed extended handshakes', () => {
        expect(() => parseExtendedHandshake(encodeBencode(toBValue({})))).toThrow(
            PeerExtendedError,
        );

        try {
            parseExtendedHandshake(encodeBencode(toBValue({})));
        } catch (error) {
            expect((error as PeerExtendedError).code).toBe(PeerExtendedErrorCode.INVALID_HANDSHAKE);
        }
    });
});
