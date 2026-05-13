import { createHash } from 'node:crypto';

export const sha1 = (bytes: Uint8Array): Uint8Array =>
    new Uint8Array(createHash('sha1').update(bytes).digest());
