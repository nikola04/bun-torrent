import { describe, expect, test } from 'bun:test';

import { PEER_ID_LENGTH, PEER_ID_PREFIX } from '../consts';
import { createPeerId } from '../peer-id';

const textDecoder = new TextDecoder();

describe('createPeerId', () => {
    test('creates a 20-byte peer id', () => {
        expect(createPeerId().byteLength).toBe(PEER_ID_LENGTH);
    });

    test('uses the bun-torrent peer id prefix', () => {
        expect(textDecoder.decode(createPeerId()).startsWith(PEER_ID_PREFIX)).toBe(true);
    });

    test('uses an alphanumeric suffix', () => {
        const peerId = textDecoder.decode(createPeerId());
        const suffix = peerId.slice(PEER_ID_PREFIX.length);

        expect(suffix).toMatch(/^[A-Za-z0-9]+$/);
        expect(suffix.length).toBe(PEER_ID_LENGTH - PEER_ID_PREFIX.length);
    });
});
