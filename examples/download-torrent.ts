import { Client } from '../src/index';

const torrentFile = process.argv[2];
const outputDirectory = process.argv[3] ?? './downloads';

if (!torrentFile) {
    console.error('Usage: bun examples/download-torrent.ts <file.torrent> [outputDirectory]');
    process.exit(1);
}

const client = new Client({ outputDirectory });

try {
    const metadata = await client.inspect({ torrentFile });
    console.log(`Torrent: ${metadata.name}`);
    console.log(`Files: ${metadata.files.length}`);

    const torrent = await client.download({ meta: metadata });

    torrent.on('progress', (progress) => {
        console.log(`${(progress.percent * 100).toFixed(2)}% - ${progress.speed}`);
    });

    torrent.on('peer', (stats) => {
        console.log(`Peers: ${stats.connections}/${stats.targetConnections}`);
    });

    await torrent.done;
    console.log('Download complete');
} finally {
    client.close();
}
