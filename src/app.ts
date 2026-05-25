#!/usr/bin/env bun

import { bytesToHex } from './utils/buffers';
import { formatBytes } from './utils/formats';
import type { DownloadProgress, TorrentMetadata, TorrentStats } from './torrent/index';
import { Client } from './client';

type CliTorrentInput =
    | {
          magnet: string;
          torrentFile?: undefined;
      }
    | {
          torrentFile: string;
          magnet?: undefined;
      };

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

const usage = (): void => {
    console.error('Usage:');
    console.error('  bunx bun-torrent inspect <file.torrent>');
    console.error('  bunx bun-torrent inspect <magnet-uri>');
    console.error('  bunx bun-torrent inspect < file.torrent');
    console.error('  bunx bun-torrent download <file.torrent|magnet-uri> [output-directory]');
};

const inspect = async (input?: string): Promise<void> => {
    const client = new Client();

    try {
        const metadata = input ? await inspectArgument(client, input) : await inspectStdin(client);

        console.log(JSON.stringify(summarizeTorrent(metadata), null, 2));
    } finally {
        client.close();
    }
};

const resolveInput = (input: string): CliTorrentInput => {
    if (input.startsWith('magnet:')) {
        return { magnet: input };
    }

    return { torrentFile: input };
};

const inspectArgument = async (client: Client, input: string): Promise<TorrentMetadata> => {
    return await client.inspect(resolveInput(input));
};

const inspectStdin = async (client: Client): Promise<TorrentMetadata> => {
    const input = new Uint8Array(await Bun.stdin.arrayBuffer());

    if (input.byteLength === 0) {
        throw new Error('Expected torrent file bytes on stdin');
    }

    return await client.inspect({ torrentFile: input });
};

const download = async (input?: string, outputDirectory = './downloads'): Promise<void> => {
    if (!input) {
        throw new Error('Expected file.torrent or magnet URI');
    }

    const client = new Client({ outputDirectory });
    let state = 'starting';
    let progress: DownloadProgress | null = null;
    let stats: TorrentStats | null = null;

    const render = (): void => renderProgressLine(state, progress, stats);

    try {
        render();
        const torrent = await client.download(resolveInput(input), {
            progressEvents: 'block',
            onChangeState: (nextState) => {
                state = nextState;
                render();
            },
        });

        progress = torrent.progress;
        stats = torrent.stats;
        render();

        torrent.on('progress', (nextProgress) => {
            progress = nextProgress;
            render();
        });
        torrent.on('peer', (nextStats) => {
            stats = nextStats;
            render();
        });

        await torrent.done;
        state = 'completed';
        progress = torrent.progress;
        stats = torrent.stats;
        render();
        process.stdout.write('\nDownload complete\n');
    } finally {
        client.close();
    }
};

const renderProgressLine = (
    state: string,
    progress: DownloadProgress | null,
    stats: TorrentStats | null,
): void => {
    const bar = progress ? progressBar(progress.percent) : progressBar(0);
    const percent = progress ? `${(progress.percent * 100).toFixed(2).padStart(6)}%` : '  0.00%';
    const downloaded = progress ? formatBytes(progress.downloadedBytes) : '0.0 B';
    const total = progress ? formatBytes(progress.totalBytes) : '?';
    const speed = progress?.speed ?? '0.0 Bps';
    const pieces = progress
        ? `pieces=${progress.completedPieces}/${progress.totalPieces}`
        : 'pieces=?/?';
    const peers = stats ? `peers=${stats.connections}/${stats.peers}` : 'peers=0/0';
    const line = `${state.padEnd(11)} ${bar} ${percent} ${downloaded}/${total} ${speed} ${pieces} ${peers}`;

    process.stdout.write(`\r${line}\x1b[K`);
};

const progressBar = (percent: number): string => {
    const width = 28;
    const normalized = Math.min(1, Math.max(0, percent));
    const filled = Math.round(normalized * width);

    return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
};

if (import.meta.main) {
    const command = Bun.argv[2];
    const input = Bun.argv[3];
    const outputDirectory = Bun.argv[4];

    try {
        switch (command) {
            case 'inspect':
                await inspect(input);
                break;
            case 'download':
                await download(input, outputDirectory);
                break;
            default:
                usage();
                process.exitCode = 1;
        }
    } catch (error) {
        if (command === 'download') process.stdout.write('\n');
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
