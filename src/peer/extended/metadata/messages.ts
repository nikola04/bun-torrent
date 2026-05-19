import { decodeBencodePartial } from '../../../torrent/bencode/decoder';
import { encodeBencode, toBValue } from '../../../torrent';
import { PeerExtendedError, PeerExtendedErrorCode } from '../errors';

export type MetadataDataMessage = {
    piece: number;
    block: Uint8Array;
};

export const encodeMetadataRequest = (piece: number): Uint8Array =>
    encodeBencode(toBValue({ msg_type: 0, piece }));

export const parseMetadataData = (data: Uint8Array): MetadataDataMessage => {
    const { value, bytesRead } = decodeBencodePartial(data);
    if (!(value instanceof Map)) {
        throw new PeerExtendedError(
            PeerExtendedErrorCode.INVALID_METADATA,
            'Metadata data must be a dict',
        );
    }

    const msgType = value.get('msg_type');
    if (msgType !== 1) {
        throw new PeerExtendedError(
            PeerExtendedErrorCode.INVALID_METADATA,
            `Expected metadata data msg_type=1, got ${msgType}`,
        );
    }

    const piece = value.get('piece');
    if (typeof piece !== 'number') {
        throw new PeerExtendedError(
            PeerExtendedErrorCode.INVALID_METADATA,
            'Metadata data is missing piece index',
        );
    }

    return { piece, block: data.subarray(bytesRead) };
};
