/** A single file inside a torrent. */
export type TorrentFile = {
    /** Path segments relative to the torrent root, e.g. `['dir', 'file.mp4']`. Never empty. */
    path: string[];
    /** File size in bytes. */
    length: number;
    /** Absolute byte offset of this file inside the concatenated torrent stream. */
    offset: number;
};

/**
 * Parsed torrent metadata returned by {@link Client.inspect} and consumed by {@link Client.download}.
 *
 * Both `.torrent` files and magnet links (after fetching the info dictionary from a peer)
 * yield this shape.
 */
export type TorrentMetadata = {
    /** Primary tracker URL from the `announce` field. May be absent for trackerless torrents. */
    announce?: string;
    /** Tiered tracker list from BEP 12. Empty when the torrent has no `announce-list`. */
    announceList: string[][];
    /** 20-byte SHA-1 of the bencoded info dictionary. Identifies the torrent on the wire. */
    infoHash: Uint8Array;
    /** Suggested torrent name. Becomes the root directory for multi-file torrents. */
    name: string;
    /** Size of each piece in bytes (last piece may be shorter). */
    pieceLength: number;
    /** 20-byte SHA-1 hash for each piece, in order. `pieces.length` is the total piece count. */
    pieces: Uint8Array[];
    /** Sum of `files[].length`, i.e. total bytes the torrent represents. */
    length: number;
    /** All files in the torrent. For single-file torrents this has length 1. */
    files: TorrentFile[];
};
