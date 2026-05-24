import { concatBytes } from '../../../utils/buffers';
import { PeerExtendedError, PeerExtendedErrorCode } from '../errors';

export const METADATA_PIECE_LENGTH = 16 * 1024;

export class MetadataAssembler {
    private readonly pieces = new Map<number, Uint8Array>();
    public readonly totalPieces: number;

    public constructor(public readonly metadataSize: number) {
        if (!Number.isInteger(metadataSize) || metadataSize <= 0) {
            throw new PeerExtendedError(
                PeerExtendedErrorCode.INVALID_HANDSHAKE,
                'Metadata size must be a positive integer',
            );
        }

        this.totalPieces = Math.ceil(metadataSize / METADATA_PIECE_LENGTH);
    }

    public get complete(): boolean {
        return this.pieces.size === this.totalPieces;
    }

    public missingPieces(): number[] {
        return Array.from({ length: this.totalPieces }, (_, piece) => piece).filter(
            (piece) => !this.pieces.has(piece),
        );
    }

    public addPiece(piece: number, block: Uint8Array): void {
        if (!Number.isInteger(piece) || piece < 0 || piece >= this.totalPieces) {
            throw new PeerExtendedError(
                PeerExtendedErrorCode.INVALID_METADATA,
                `Metadata piece index is out of range: ${piece}`,
            );
        }

        const expectedLength = this.getExpectedPieceLength(piece);
        if (block.byteLength !== expectedLength) {
            throw new PeerExtendedError(
                PeerExtendedErrorCode.INVALID_METADATA,
                `Metadata piece ${piece} length must be ${expectedLength}, got ${block.byteLength}`,
            );
        }

        this.pieces.set(piece, block);
    }

    public assemble(): Uint8Array {
        if (!this.complete) {
            throw new PeerExtendedError(
                PeerExtendedErrorCode.INVALID_METADATA,
                'Metadata is incomplete',
            );
        }

        return concatBytes(Array.from({ length: this.totalPieces }, (_, i) => this.pieces.get(i)!));
    }

    private getExpectedPieceLength(piece: number): number {
        if (piece < this.totalPieces - 1) return METADATA_PIECE_LENGTH;

        const finalLength = this.metadataSize % METADATA_PIECE_LENGTH;
        return finalLength === 0 ? METADATA_PIECE_LENGTH : finalLength;
    }
}
