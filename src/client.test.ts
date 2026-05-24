import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeBencode, toBValue } from './torrent/index';
import { Client } from './client';
import { ClientError, ClientErrorCode } from './client.error';
import { TorrentState } from './torrent/session';

const makeTorrent = ({ announce }: { announce?: string } = {}): Uint8Array => {
    const root: {
        announce?: string;
        info: {
            length: number;
            name: string;
            'piece length': number;
            pieces: Uint8Array;
        };
    } = {
        info: {
            length: 12345,
            name: 'file.bin',
            'piece length': 16384,
            pieces: new Uint8Array(20),
        },
    };

    if (announce !== undefined) root.announce = announce;

    return encodeBencode(toBValue(root));
};

describe('Client.inspect', () => {
    test('inspects torrent metadata from Uint8Array input', async () => {
        const client = new Client();
        const metadata = await client.inspect({
            torrentFile: makeTorrent({ announce: 'https://tracker.test/announce' }),
        });

        expect(metadata.name).toBe('file.bin');
        expect(metadata.length).toBe(12345);
        expect(metadata.files).toEqual([{ path: ['file.bin'], length: 12345, offset: 0 }]);
    });

    test('inspects torrent metadata from ArrayBuffer input', async () => {
        const client = new Client();
        const torrent = makeTorrent({ announce: 'https://tracker.test/announce' });
        const arrayBuffer = torrent.buffer.slice(
            torrent.byteOffset,
            torrent.byteOffset + torrent.byteLength,
        ) as ArrayBuffer;
        const metadata = await client.inspect({ torrentFile: arrayBuffer });

        expect(metadata.name).toBe('file.bin');
        expect(metadata.pieces).toHaveLength(1);
    });

    test('inspects torrent metadata from file path input', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'bun-torrent-client-'));
        const path = join(outputDirectory, 'inspect.torrent');
        await writeFile(path, makeTorrent({ announce: 'https://tracker.test/announce' }));

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

describe('Client.download', () => {
    test('uses configurable peer connection targets', async () => {
        const client = new Client({ targetConnections: 40, dht: false });

        const torrent = await client.download(
            { torrentFile: makeTorrent() },
            { targetConnections: 12 },
        );

        expect(torrent.stats.targetConnections).toBe(12);
        await torrent.done;
    });

    test('uses default peer connection targets when none are configured', async () => {
        const client = new Client({ dht: false });

        const torrent = await client.download({ torrentFile: makeTorrent() });

        expect(torrent.stats.targetConnections).toBe(20);
        await torrent.done;
    });

    test('returns an empty torrent instead of rejecting when no trackers are available', async () => {
        const states: string[] = [];
        const client = new Client({ dht: false });

        const torrent = await client.download(
            { torrentFile: makeTorrent() },
            { onChangeState: (state) => states.push(state) },
        );

        expect(states).toEqual(['parsing', 'tracking', 'connecting', 'downloading']);
        expect(torrent.stats).toMatchObject({
            peers: 0,
            connections: 0,
            failedConnections: 0,
        });
        await torrent.done;
    });

    test('falls back to DHT peer discovery when trackers are unavailable', async () => {
        let lookups = 0;
        const client = new Client({
            dht: {
                async lookupPeers() {
                    lookups += 1;
                    return [];
                },
            },
        });

        const torrent = await client.download({ torrentFile: makeTorrent() });

        expect(lookups).toBe(1);
        await torrent.done;
    });

    test('rejects unknown selected files', async () => {
        const client = new Client();

        await expect(
            client.download({ torrentFile: makeTorrent() }, { files: ['missing.bin'] }),
        ).rejects.toMatchObject({
            code: ClientErrorCode.INVALID_FILE_SELECTION,
        });
    });
});

describe('Client.close', () => {
    test('closes active torrents', async () => {
        const client = new Client({ dht: false });
        const torrent = await client.download({ torrentFile: makeTorrent() });

        client.close();

        expect(torrent.state).toBe(TorrentState.CLOSED);
        await torrent.done;
    });

    test('rejects new operations after close', async () => {
        const client = new Client();
        client.close();

        await expect(client.inspect({ torrentFile: makeTorrent() })).rejects.toMatchObject({
            code: ClientErrorCode.CLOSED,
        });
        await expect(client.download({ torrentFile: makeTorrent() })).rejects.toMatchObject({
            code: ClientErrorCode.CLOSED,
        });
    });
});
