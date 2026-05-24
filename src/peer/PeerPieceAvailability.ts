export type PeerPieceAvailabilityOptions = {
    bitfield?: Uint8Array;
};

/**
 * Mutable view of which torrent pieces a peer claims to have.
 */
export class PeerPieceAvailability {
    private readonly pieces: boolean[];

    /**
     * Create availability state from an optional peer bitfield.
     *
     * @param totalPieces - Number of pieces in the torrent.
     * @param options - Optional initial bitfield from the peer.
     */
    public constructor(
        public readonly totalPieces: number,
        options: PeerPieceAvailabilityOptions = {},
    ) {
        this.pieces = Array.from({ length: totalPieces }, (_, pieceIndex) =>
            options.bitfield ? hasBitfieldPiece(options.bitfield, pieceIndex) : false,
        );
    }

    /**
     * Return true when the peer claims to have a piece.
     *
     * @param pieceIndex - Zero-based piece index.
     * @returns Whether the peer has the piece. Invalid indexes return false.
     */
    public hasPiece(pieceIndex: number): boolean {
        return this.pieces[pieceIndex] ?? false;
    }

    /**
     * Mark one piece as available after receiving a peer `have` message.
     *
     * @param pieceIndex - Zero-based piece index.
     */
    public markHave(pieceIndex: number): void {
        if (!Number.isInteger(pieceIndex) || pieceIndex < 0 || pieceIndex >= this.totalPieces) {
            return;
        }

        this.pieces[pieceIndex] = true;
    }

    /**
     * Replace availability from a peer `bitfield` message.
     *
     * @param bitfield - Raw bitfield payload from the peer.
     */
    public setBitfield(bitfield: Uint8Array): void {
        for (let pieceIndex = 0; pieceIndex < this.totalPieces; pieceIndex += 1) {
            this.pieces[pieceIndex] = hasBitfieldPiece(bitfield, pieceIndex);
        }
    }

    /**
     * Return available piece indexes in ascending order.
     *
     * @returns Piece indexes currently marked as available.
     */
    public toPieceIndexes(): number[] {
        return this.pieces.flatMap((available, pieceIndex) => (available ? [pieceIndex] : []));
    }
}

/**
 * Create mutable availability state from an optional peer bitfield.
 *
 * @param totalPieces - Number of pieces in the torrent.
 * @param bitfield - Optional raw bitfield payload from the peer.
 * @returns Peer piece availability state.
 */
export const createPeerPieceAvailability = (
    totalPieces: number,
    bitfield?: Uint8Array,
): PeerPieceAvailability => new PeerPieceAvailability(totalPieces, { bitfield });

const hasBitfieldPiece = (bitfield: Uint8Array, pieceIndex: number): boolean => {
    const byte = bitfield[Math.floor(pieceIndex / 8)];
    if (byte === undefined) return false;

    const mask = 0x80 >> (pieceIndex % 8);
    return (byte & mask) !== 0;
};
