import type { PeerInfo } from '../../../tracker';
import { defaults } from '../../../configs/defaults';
import { decodeBencode, type BValue } from '../../../torrent';
import { sha1 } from '../../../utils/sha1';
import { openExtendedConnection, type OpenExtendedConnectionOptions } from '../connection';
import { PeerExtendedError, PeerExtendedErrorCode } from '../errors';
import { MetadataAssembler } from './assembler';
import { encodeMetadataRequest, parseMetadataData } from './messages';

export type FetchMetadataFromPeerOptions = {
    timeoutMs?: number;
    createSocket?: OpenExtendedConnectionOptions['createSocket'];
};

const LOCAL_UT_METADATA_ID = 1;
const UT_METADATA_EXTENSION = 'ut_metadata';

export const fetchMetadataFromPeer = async (
    peer: PeerInfo,
    infoHash: Uint8Array,
    peerId: Uint8Array,
    options: FetchMetadataFromPeerOptions = {},
): Promise<BValue> => {
    const timeoutMs = options.timeoutMs ?? defaults.magnet.peerTimeoutMs;
    const connection = await openExtendedConnection({
        peer,
        infoHash,
        peerId,
        timeoutMs,
        localExtensions: { [UT_METADATA_EXTENSION]: LOCAL_UT_METADATA_ID },
        createSocket: options.createSocket,
    });

    const remoteUtMetadataId = connection.remoteExtensions.get(UT_METADATA_EXTENSION);
    if (!remoteUtMetadataId || !connection.metadataSize) {
        connection.close();
        throw new PeerExtendedError(
            PeerExtendedErrorCode.UNSUPPORTED_UT_METADATA,
            'Peer does not support ut_metadata',
        );
    }

    const assembler = new MetadataAssembler(connection.metadataSize);

    return new Promise((resolve, reject) => {
        let settled = false;
        let offMessage = (): void => {};
        const timeout = setTimeout(() => {
            rejectOnce(
                new PeerExtendedError(
                    PeerExtendedErrorCode.CONNECTION_TIMEOUT,
                    'Peer metadata download timed out',
                ),
            );
        }, options.timeoutMs);

        const resolveOnce = (value: BValue): void => {
            if (settled) return;

            settled = true;
            clearTimeout(timeout);
            offMessage();
            connection.close();
            resolve(value);
        };

        const rejectOnce = (error: unknown): void => {
            if (settled) return;

            settled = true;
            clearTimeout(timeout);
            offMessage();
            connection.close();
            reject(error);
        };

        offMessage = connection.onMessage((message) => {
            try {
                if (message.extId !== LOCAL_UT_METADATA_ID) return;

                const { piece, block } = parseMetadataData(message.data);
                assembler.addPiece(piece, block);

                if (!assembler.complete) return;

                const assembled = assembler.assemble();
                const hash = sha1(assembled);
                if (!hash.every((b, i) => b === infoHash[i])) {
                    throw new PeerExtendedError(
                        PeerExtendedErrorCode.METADATA_HASH_MISMATCH,
                        'Metadata hash does not match magnet info hash',
                    );
                }

                resolveOnce(decodeBencode(assembled));
            } catch (error) {
                rejectOnce(error);
            }
        });

        for (const piece of assembler.missingPieces()) {
            connection.send(remoteUtMetadataId, encodeMetadataRequest(piece));
        }
    });
};
