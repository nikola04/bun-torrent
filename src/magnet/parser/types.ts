export type ParsedMagnetURI = {
    infoHash: Uint8Array;
    name?: string;
    trackers: string[];
};
