import { describe, expect, test } from 'bun:test';

import { decodeBencode, encodeBencode, toBValue } from '../../../torrent';
import { concatBytes } from '../../../utils/buffers';
import { PeerExtendedError, PeerExtendedErrorCode } from '../errors';
import { encodeMetadataRequest, parseMetadataData } from './messages';

describe('metadata extension messages', () => {
    test('encodes metadata requests', () => {
        const request = decodeBencode(encodeMetadataRequest(3));

        expect(request).toEqual(
            new Map([
                ['msg_type', 0],
                ['piece', 3],
            ]),
        );
    });

    test('parses metadata data messages', () => {
        const block = new Uint8Array([1, 2, 3]);
        const data = concatBytes([
            encodeBencode(toBValue({ msg_type: 1, piece: 2, total_size: 123 })),
            block,
        ]);

        expect(parseMetadataData(data)).toEqual({ piece: 2, block });
    });

    test('rejects non-data metadata messages', () => {
        const data = encodeBencode(toBValue({ msg_type: 2, piece: 0 }));

        try {
            parseMetadataData(data);
            throw new Error('Expected parseMetadataData to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(PeerExtendedError);
            expect((error as PeerExtendedError).code).toBe(PeerExtendedErrorCode.INVALID_METADATA);
        }
    });
});
