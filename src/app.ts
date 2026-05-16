import { bytesToHex } from './utils/buffers';
import type { TorrentMetadata } from './torrent/index';
import { Client } from './client';

type InspectSummary = {
    announce?: string;
    announceList: string[][];
    infoHash: string;
    name: string;
    pieceLength: number;
    piecesTotal: number;
    length: number;
    files: Array<{
        path: string;
        length: number;
        offset: number;
    }>;
    filesTotal: number;
};

const summarizeTorrent = (metadata: TorrentMetadata): InspectSummary => ({
    announce: metadata.announce,
    announceList: metadata.announceList,
    infoHash: bytesToHex(metadata.infoHash),
    name: metadata.name,
    pieceLength: metadata.pieceLength,
    piecesTotal: metadata.pieces.length,
    length: metadata.length,
    files: metadata.files.map((file) => ({
        path: file.path.join('/'),
        length: file.length,
        offset: file.offset,
    })),
    filesTotal: metadata.files.length,
});

const inspectStdin = async (): Promise<void> => {
    const input = new Uint8Array(await Bun.stdin.arrayBuffer());

    if (input.byteLength === 0) {
        console.error('Usage: bun src/app.ts < file.torrent');
        process.exitCode = 1;
        return;
    }

    try {
        const client = new Client();
        const metadata = await client.inspect({ torrentFile: input });
        console.log(JSON.stringify(summarizeTorrent(metadata), null, 2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
};

if (import.meta.main) {
    const command = Bun.argv[2];

    if (command === 'inspect') {
        await inspectStdin();
    } else {
        console.error('Usage: bun src/app.ts inspect < file.torrent');
        process.exitCode = 1;
    }
}
