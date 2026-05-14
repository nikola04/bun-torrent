import { describe, expect, test } from 'bun:test';

import { BunTorrentError } from '@utils/errors';
import { PeerSession, PeerSessionError, PeerSessionErrorCode } from '.';

const bytes20 = new Uint8Array(20);

describe('PeerSession', () => {
    test('rejects connecting a closed session with a peer session error', async () => {
        const session = new PeerSession({ ip: '127.0.0.1', port: 1 });
        session.close();

        expect(session.connect(bytes20, bytes20)).rejects.toBeInstanceOf(PeerSessionError);
        expect(session.connect(bytes20, bytes20)).rejects.toBeInstanceOf(BunTorrentError);
        expect(session.connect(bytes20, bytes20)).rejects.toMatchObject({
            code: PeerSessionErrorCode.CLOSED,
        });
    });
});
