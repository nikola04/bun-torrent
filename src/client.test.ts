import { describe, expect, test } from 'bun:test';

import { encodeBencode, toBValue } from '@torrent/index';
import { Client } from './client';
import { ClientError, ClientErrorCode } from './client.error';

const makeTorrent = (): Uint8Array =>
    encodeBencode(
        toBValue({
            announce: 'https://tracker.test/announce',
            info: {
                length: 12345,
                name: 'file.bin',
                'piece length': 16384,
                pieces: new Uint8Array(20),
            },
        }),
    );

describe('Client.inspect', () => {
    test('inspects torrent metadata from Uint8Array input', async () => {
        const client = new Client();
        const metadata = await client.inspect({ torrentFile: makeTorrent() });

        expect(metadata.name).toBe('file.bin');
        expect(metadata.length).toBe(12345);
        expect(metadata.files).toEqual([{ path: ['file.bin'], length: 12345, offset: 0 }]);
    });

    test('inspects torrent metadata from ArrayBuffer input', async () => {
        const client = new Client();
        const torrent = makeTorrent();
        const arrayBuffer = torrent.buffer.slice(
            torrent.byteOffset,
            torrent.byteOffset + torrent.byteLength,
        ) as ArrayBuffer;
        const metadata = await client.inspect({ torrentFile: arrayBuffer });

        expect(metadata.name).toBe('file.bin');
        expect(metadata.pieces).toHaveLength(1);
    });

    test('inspects torrent metadata from file path input', async () => {
        const path = '/private/tmp/bun-torrent-client-inspect.torrent';
        await Bun.write(path, makeTorrent());

        const client = new Client();
        const metadata = await client.inspect({ torrentFile: path });

        expect(metadata.name).toBe('file.bin');
        expect(metadata.announce).toBe('https://tracker.test/announce');
    });

    test('rejects unsupported torrent file input with a client error', async () => {
        const client = new Client();

        expect(
            client.inspect({ torrentFile: null as unknown as Uint8Array }),
        ).rejects.toMatchObject({
            code: ClientErrorCode.UNSUPPORTED_TORRENT_FILE_INPUT,
        });
        expect(
            client.inspect({ torrentFile: null as unknown as Uint8Array }),
        ).rejects.toBeInstanceOf(ClientError);
    });
});
