export enum PeerMessageId {
    Choke = 0,
    Unchoke = 1,
    Interested = 2,
    NotInterested = 3,
    Have = 4,
    Bitfield = 5,
    Request = 6,
    Piece = 7,
    Cancel = 8,
}

export type KeepAliveMessage = {
    type: 'keep-alive';
};

export type ChokeMessage = {
    type: 'choke';
};

export type UnchokeMessage = {
    type: 'unchoke';
};

export type InterestedMessage = {
    type: 'interested';
};

export type NotInterestedMessage = {
    type: 'not-interested';
};

export type HaveMessage = {
    type: 'have';
    pieceIndex: number;
};

export type BitfieldMessage = {
    type: 'bitfield';
    bitfield: Uint8Array;
};

export type RequestMessage = {
    type: 'request';
    pieceIndex: number;
    offset: number;
    length: number;
};

export type PieceMessage = {
    type: 'piece';
    pieceIndex: number;
    offset: number;
    block: Uint8Array;
};

export type CancelMessage = {
    type: 'cancel';
    pieceIndex: number;
    offset: number;
    length: number;
};

export type PeerMessage =
    | KeepAliveMessage
    | ChokeMessage
    | UnchokeMessage
    | InterestedMessage
    | NotInterestedMessage
    | HaveMessage
    | BitfieldMessage
    | RequestMessage
    | PieceMessage
    | CancelMessage;

export { PeerMessageError, PeerMessageErrorCode } from './error';
