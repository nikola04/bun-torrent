import type { BValue } from './types';

export type BencodeInput =
    | number
    | string
    | Uint8Array
    | BencodeInput[]
    | { readonly [key: string]: BencodeInput };

export const toBValue = (input: BencodeInput): BValue => {
    if (typeof input === 'number') return input;
    if (typeof input === 'string') return new TextEncoder('utf-8').encode(input);
    if (input instanceof Uint8Array) return input;
    if (Array.isArray(input)) return input.map(toBValue);

    return new Map(Object.entries(input).map(([key, value]) => [key, toBValue(value)]));
};
