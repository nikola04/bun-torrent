import { decodeBencode, encodeBencode, toBValue } from '../../torrent';
import { encodePeerMessage } from '../messages';
import { PeerExtendedError, PeerExtendedErrorCode } from './errors';

export const EXTENDED_HANDSHAKE_ID = 0;

export type ExtendedHandshake = {
    extensions: Map<string, number>;
    metadataSize?: number;
};

export const encodeExtendedHandshake = (extensions: Record<string, number>): Uint8Array => {
    const extHandshake = encodeBencode(toBValue({ m: extensions }));

    return encodeExtMessage(EXTENDED_HANDSHAKE_ID, extHandshake);
};

export const parseExtendedHandshake = (data: Uint8Array): ExtendedHandshake => {
    const dict = decodeBencode(data);
    if (!(dict instanceof Map)) {
        throw new PeerExtendedError(
            PeerExtendedErrorCode.INVALID_HANDSHAKE,
            'Extension handshake must be a dict',
        );
    }

    const m = dict.get('m');
    if (!(m instanceof Map)) {
        throw new PeerExtendedError(
            PeerExtendedErrorCode.INVALID_HANDSHAKE,
            'Extension handshake is missing m dict',
        );
    }

    const extensions = new Map<string, number>();
    for (const [name, id] of m) {
        if (typeof name !== 'string' || typeof id !== 'number') continue;
        extensions.set(name, id);
    }

    const metadataSize = dict.get('metadata_size');
    if (metadataSize !== undefined && typeof metadataSize !== 'number') {
        throw new PeerExtendedError(
            PeerExtendedErrorCode.INVALID_HANDSHAKE,
            'Extension handshake metadata_size must be a number',
        );
    }

    return { extensions, metadataSize };
};

export const encodeExtMessage = (extId: number, data: Uint8Array): Uint8Array =>
    encodePeerMessage({ type: 'extended', extId, data });
