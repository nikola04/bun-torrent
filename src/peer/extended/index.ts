import type { PeerInfo } from '../../tracker';
import { createConnection } from 'node:net';
import { decodeHandshake, encodeHandshake } from '../handshake';
import { concatBytes } from '../../utils/buffers';
import { HANDSHAKE_LENGTH } from '../consts';
import { decodePeerMessage, encodePeerMessage, type PeerMessage } from '../messages';
import { decodeBencode, encodeBencode, toBValue, type BValue } from '../../torrent';
import { decodeBencodePartial } from '../../torrent/bencode/decoder';
import { sha1 } from '../../utils/sha1';

export const fetchExtendedFromPeer = async (
    peer: PeerInfo,
    infoHash: Uint8Array,
    peerId: Uint8Array,
    timeoutMs: number = 5_000,
): Promise<BValue> => {
    const socket = createConnection({
        host: peer.ip,
        port: peer.port,
    });

    const pieces = new Map<number, Uint8Array>();
    let totalPieces = 0;
    let utMetadataId = 0;

    let buffer: Uint8Array = new Uint8Array(0);
    let handshakeDone = false;

    return new Promise((resolve, reject) => {
        let settled = false;

        const timeout = setTimeout(() => {
            rejectOnce(new Error('Peer connection timed out'));
        }, timeoutMs);

        const resolveOnce = (data: BValue) => {
            if (settled) return;

            settled = true;
            clearTimeout(timeout);
            socket.destroy();

            resolve(data);
        };

        const rejectOnce = (error: unknown) => {
            if (settled) return;

            settled = true;
            clearTimeout(timeout);
            socket.destroy();
            reject(error);
        };

        socket.on('connect', () => {
            const reserved = new Uint8Array(8);
            reserved[5]! |= 0x10;

            socket.write(encodeHandshake({ infoHash, peerId, reserved }));
        });

        socket.on('data', (data) => {
            try {
                const bytes =
                    typeof data === 'string'
                        ? new TextEncoder().encode(data)
                        : new Uint8Array(data);

                buffer = concatBytes([buffer, bytes]);

                if (!handshakeDone) {
                    if (buffer.length < HANDSHAKE_LENGTH) return;

                    const handshake = decodeHandshake(buffer.slice(0, HANDSHAKE_LENGTH));

                    if (!handshake.infoHash.every((b, i) => b === infoHash[i])) {
                        reject(new Error('Handshake info hash does not match torrent info hash'));
                        return;
                    }

                    handshakeDone = true;
                    buffer = buffer.slice(HANDSHAKE_LENGTH);

                    const extHandshake = encodeBencode(toBValue({ m: { ut_metadata: 1 } }));
                    socket.write(encodeExtMessage(0, extHandshake));
                    return;
                }

                while (handshakeDone && buffer.byteLength >= 4) {
                    const frameLength = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(
                        0,
                        false,
                    );

                    const totalLength = 4 + frameLength;

                    if (buffer.byteLength < totalLength) return;

                    const frame = buffer.slice(0, totalLength);
                    buffer = buffer.slice(totalLength);
                    handleMessage(decodePeerMessage(frame));
                }
            } catch (error) {
                rejectOnce(error);
            }
        });

        const handleMessage = (message: PeerMessage): void => {
            if (message.type !== 'extended') return;

            if (message.extId === 0) {
                const parsed = assertExtHandshake(decodeBencode(message.data));
                utMetadataId = parsed.utMetadataId;
                totalPieces = Math.ceil(parsed.metadataSize / (16 * 1024));

                if (!utMetadataId || !parsed.metadataSize) {
                    rejectOnce(new Error('Peer does not support ut_metadata'));
                    return;
                }

                for (let i = 0; i < totalPieces; i++) {
                    const req = encodeBencode(toBValue({ msg_type: 0, piece: i }));
                    socket.write(encodeExtMessage(utMetadataId, req));
                }

                return;
            }

            if (message.extId !== 1) return;

            const { piece, block } = parseMetadataData(message.data);
            pieces.set(piece, block);

            if (pieces.size === totalPieces) {
                const assembled = concatBytes(
                    Array.from({ length: totalPieces }, (_, i) => pieces.get(i)!),
                );
                const bvalue = decodeBencode(assembled);

                const hash = sha1(assembled);
                if (!hash.every((b, i) => b === infoHash[i]))
                    throw new Error('Metadata hash mismatch');

                resolveOnce(bvalue);
            }
        };

        socket.on('error', rejectOnce);
    });
};

const parseMetadataData = (data: Uint8Array): { piece: number; block: Uint8Array } => {
    const { value, bytesRead } = decodeBencodePartial(data);
    if (!(value instanceof Map)) throw new Error('Metadata data must be a dict');

    const msgType = value.get('msg_type');
    if (msgType !== 1) throw new Error(`Expected msg_type=1, got ${msgType}`);

    const piece = value.get('piece');
    if (typeof piece !== 'number') throw new Error('Missing piece index');

    return { piece, block: data.subarray(bytesRead) };
};

const encodeExtMessage = (extId: number, data: Uint8Array): Uint8Array =>
    encodePeerMessage({ type: 'extended', extId, data });

const assertExtHandshake = (dict: unknown): { utMetadataId: number; metadataSize: number } => {
    if (!(dict instanceof Map)) throw new Error('Extension handshake must be a dict');

    const m = dict.get('m');
    if (!(m instanceof Map)) throw new Error('Extension handshake missing m dict');

    const utMetadataId = m.get('ut_metadata');
    if (typeof utMetadataId !== 'number') throw new Error('Peer does not support ut_metadata');

    const metadataSize = dict.get('metadata_size');
    if (typeof metadataSize !== 'number')
        throw new Error('Extension handshake missing metadata_size');

    return { utMetadataId, metadataSize };
};
