export type KrpcTransactionId = Uint8Array;

export enum KrpcMessageType {
    Query = 'q',
    Response = 'r',
    Error = 'e',
}

export enum KrpcQueryType {
    Ping = 'ping',
    FindNode = 'find_node',
    GetPeers = 'get_peers',
    AnnouncePeer = 'announce_peer',
}

export type KrpcQuery =
    | {
          type: 'query';
          transactionId: Uint8Array;
          query: 'ping';
          id: Uint8Array;
      }
    | {
          type: 'query';
          transactionId: Uint8Array;
          query: 'find_node';
          id: Uint8Array;
          target: Uint8Array;
      }
    | {
          type: 'query';
          transactionId: Uint8Array;
          query: 'get_peers';
          id: Uint8Array;
          infoHash: Uint8Array;
      };

export type KrpcResponse =
    | {
          type: 'response';
          transactionId: Uint8Array;
          id: Uint8Array;
      }
    | {
          type: 'response';
          transactionId: Uint8Array;
          id: Uint8Array;
          nodes: Uint8Array;
          token?: Uint8Array;
      }
    | {
          type: 'response';
          transactionId: Uint8Array;
          id: Uint8Array;
          values: Uint8Array[];
          token: Uint8Array;
      };

export type KrpcError = {
    type: 'error';
    transactionId: Uint8Array;
    code: number;
    message: string;
};

export type KrpcMessage = KrpcQuery | KrpcResponse | KrpcError;
