import { BunTorrentError } from '@utils/errors';

export enum ClientErrorCode {
    INVALID_FILE_SELECTION = 'CLIENT_INVALID_FILE_SELECTION',
    UNSUPPORTED_TORRENT_FILE_INPUT = 'CLIENT_UNSUPPORTED_TORRENT_FILE_INPUT',
}

export class ClientError extends BunTorrentError {
    constructor(code: ClientErrorCode, message: string) {
        super(message, code);
    }
}
