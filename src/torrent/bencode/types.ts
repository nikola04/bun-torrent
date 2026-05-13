export type BValue = BBytes | BInteger | BList | BDict;

export type BBytes = Uint8Array;
export type BInteger = number;
export type BList = BValue[];
export type BDict = Map<string, BValue>;

export enum FLAG {
    INTEGER = 0x69,
    MINUS = 0x2d,
    LIST = 0x6c,
    DICTIONARY = 0x64,
    END = 0x65,
    STR_DELIMITER = 0x3a,
}
