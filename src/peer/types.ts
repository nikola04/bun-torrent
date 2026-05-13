export type PeerHandshake = {
    protocol: string;
    reserved: Uint8Array;
    infoHash: Uint8Array;
    peerId: Uint8Array;
};
