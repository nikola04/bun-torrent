import { Client } from '../src/index';

const magnet = process.argv[2];
const outputDirectory = process.argv[3] ?? './downloads';

if (!magnet) {
    console.error('Usage: bun examples/magnet-dht.ts <magnet-uri> [outputDirectory]');
    process.exit(1);
}

const client = new Client({ outputDirectory });

try {
    const metadata = await client.inspect({ magnet });
    console.log(`Torrent: ${metadata.name}`);
    console.log(`Trackers: ${metadata.announceList.flat().length}`);

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
