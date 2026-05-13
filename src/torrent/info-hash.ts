import { sha1 } from '@utils/sha1';
import { encodeBencode } from './bencode';
import type { BDict } from './bencode/types';

export const computeInfoHash = (info: BDict): Uint8Array => {
    return sha1(encodeBencode(info));
};
