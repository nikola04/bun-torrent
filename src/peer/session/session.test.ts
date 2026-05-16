import { describe, expect, test } from 'bun:test';

import { encodeHandshake } from '../handshake';
import { decodePeerMessage, encodePeerMessage } from '../messages';
import { PeerPieceAvailability } from '../availability';
import { BunTorrentError } from '../../utils/errors';
import { concatBytes } from '../../utils/buffers';
import { PeerSession, PeerSessionError, PeerSessionErrorCode } from '.';

const bytes20 = new Uint8Array(20);
const peerId = new Uint8Array(20).fill(1);

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

    test('tracks peer availability and choke state from incoming messages', async () => {
        const session = new PeerSession({ ip: '127.0.0.1', port: 1 });
        const testSession = asTestableSession(session);
        const messages: string[] = [];
        session.onMessage((message) => messages.push(message.type));

        testSession.availability = new PeerPieceAvailability(10);
        testSession.handleData(
            concatBytes([
                encodeHandshake({ infoHash: bytes20, peerId }),
                encodePeerMessage({
                    type: 'bitfield',
                    bitfield: new Uint8Array([0b1010_0001, 0b1000_0000]),
                }),
                encodePeerMessage({ type: 'have', pieceIndex: 9 }),
                encodePeerMessage({ type: 'unchoke' }),
            ]),
            bytes20,
            () => undefined,
            (error) => {
                throw error;
            },
        );

        expect(messages).toEqual(['bitfield', 'have', 'unchoke']);
        expect(session.peerAvailability.toPieceIndexes()).toEqual([0, 2, 7, 8, 9]);
        expect(session.choked).toBe(false);
    });

    test('sends encoded peer messages after connecting', async () => {
        const session = new PeerSession({ ip: '127.0.0.1', port: 1 });
        const testSession = asTestableSession(session);
        const received = new Uint8ArrayCollector();

        testSession.socket = {
            write(bytes: Uint8Array) {
                received.push(bytes);
                return true;
            },
        };

        session.sendMessage({ type: 'interested' });

        expect(decodePeerMessage(received.bytes())).toEqual({ type: 'interested' });
        expect(session.interested).toBe(true);
    });

    test('notifies close listeners once when closed explicitly', () => {
        const session = new PeerSession({ ip: '127.0.0.1', port: 1 });
        let closeCount = 0;
        session.onClose(() => {
            closeCount += 1;
        });

        session.close();
        session.close();

        expect(closeCount).toBe(1);
    });
});

type TestablePeerSession = {
    availability: PeerPieceAvailability;
    handleData(
        incoming: Uint8Array,
        infoHash: Uint8Array,
        resolve: () => void,
        reject: (error: Error) => void,
    ): void;
    socket: { write(bytes: Uint8Array): boolean } | null;
};

const asTestableSession = (session: PeerSession): TestablePeerSession =>
    session as unknown as TestablePeerSession;

class Uint8ArrayCollector {
    private chunks: Uint8Array[] = [];

    public push(bytes: Uint8Array): void {
        this.chunks.push(bytes);
    }

    public bytes(): Uint8Array {
        return concatBytes(this.chunks);
    }
}
