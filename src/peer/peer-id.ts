import { ALPHABET, PEER_ID_PREFIX } from './consts';

const textEncoder = new TextEncoder('utf-8');

export const createPeerId = (): Uint8Array => {
    const random = crypto.getRandomValues(new Uint8Array(12));
    const suffix = [...random].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
    return textEncoder.encode(`${PEER_ID_PREFIX}${suffix}`);
};
