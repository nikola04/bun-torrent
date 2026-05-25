# bun-torrent

A minimal Bun-native BitTorrent download-only client written in TypeScript.

`bun-torrent` can parse `.torrent` files and magnet links, announce to HTTP and UDP trackers, discover peers through the BitTorrent DHT, connect to peers, download pieces, validate piece hashes, and write the downloaded files to disk. The public API is intentionally small: create a `Client`, inspect a torrent when you need metadata, then call `download()`.

It has no runtime dependencies.

## Requirements

- Bun `>= 1.3.0`

## Installation

```bash
bun add bun-torrent
```

or:

```bash
npm install bun-torrent
```

## Basic Usage

```ts
import { Client } from 'bun-torrent';

const client = new Client({
    outputDirectory: './downloads',
});

const torrent = await client.download({
    torrentFile: './example.torrent',
});

torrent.on('progress', (progress) => {
    console.log({
        percent: `${(progress.percent * 100).toFixed(2)}%`,
        downloaded: progress.downloadedBytes,
        received: progress.receivedBytes,
        speed: progress.speed,
    });
});

torrent.on('done', () => {
    console.log('Download complete');
});

torrent.on('error', (error) => {
    console.error('Download failed', error);
});

await torrent.done;
```

`download()` returns a `Torrent` instance and starts the download immediately.

## Runnable Example Files

Runnable example files are available in `examples/`:

```bash
bun examples/download-torrent.ts ./example.torrent ./downloads
bun examples/magnet-dht.ts "magnet:?xt=urn:btih:..." ./downloads
```

The magnet example works with tracker-backed and trackerless magnets. It uses the default in-memory DHT node and closes the client before exiting.

## Client Setup

```ts
import { Client } from 'bun-torrent';

const client = new Client({
    outputDirectory: './downloads',
    targetConnections: 20,
    maxConnecting: 30,
    maxInFlightRequestsPerPeer: 20,
    peerConnectTimeoutMs: 5_000,
    trackerTimeoutMs: 5_000,
    requestTimeoutMs: 15_000,
    seed: false,
    progressEvents: 'piece',
    speedSampleIntervalMs: 500,
});
```

Client options:

- `dht`: optional DHT peer discovery implementation, or `false` to disable DHT. By default, the client creates an in-memory DHT node.
- `outputDirectory`: directory where downloaded files are written. Defaults to `process.cwd()`.
- `files`: optional default file selection for downloads.
- `targetConnections`: preferred number of connected peers. Defaults to `20`.
- `minConnections`: minimum connectable peer count before downloading starts. Defaults to `0`.
- `maxConnecting`: maximum simultaneous peer connection attempts. Defaults to `30`.
- `peerConnectTimeoutMs`: timeout for connecting to one peer. Defaults to `5000`.
- `trackerTimeoutMs`: timeout for tracker announces. Defaults to `5000`.
- `maxInFlightRequestsPerPeer`: maximum active block requests per peer. Defaults to `20`.
- `requestTimeoutMs`: timeout for an individual block request. Defaults to `15000`.
- `seed`: reserved for future seeding support. Currently only `false` is supported.
- `progressEvents`: `'piece'` emits progress when a piece completes, `'block'` emits for every received block. Defaults to `'piece'`.
- `speedSampleIntervalMs`: minimum interval used to refresh speed calculations. Defaults to `500`.

Options passed to `download()` override the client defaults for that download.

## Inspecting a Torrent

Use `inspect()` when you want metadata before starting a download, for example to show the file list or choose only some files.

```ts
const metadata = await client.inspect({
    torrentFile: './example.torrent',
});

console.log(metadata.name);
console.log(metadata.length);
console.log(metadata.files);
```

Torrent file input can be a file path, `Uint8Array`, or `ArrayBuffer`.

Call `client.close()` when the client should stop accepting work and close active torrents and its DHT socket.

## Magnet Links

Magnet links are supported with or without trackers. If `tr` parameters are present, the client asks those trackers first. If no tracker returns peers, or the magnet is trackerless, the client falls back to DHT peer discovery. Metadata is fetched from peers with the `ut_metadata` extension before the normal download flow starts.

```ts
const magnet =
    'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567' +
    '&dn=file.bin' +
    '&tr=udp%3A%2F%2Ftracker.example.com%3A6969%2Fannounce';

const metadata = await client.inspect({ magnet });

console.log(metadata.name);
console.log(metadata.files);

const torrent = await client.download(
    { magnet },
    {
        outputDirectory: './downloads',
    },
);

await torrent.done;
```

Trackerless magnets use the same API. Keep the same `Client` instance if you inspect first and download later, because the default DHT node keeps discovered peers in memory for the current process.

```ts
import { Client } from 'bun-torrent';

const client = new Client({
    outputDirectory: './downloads',
});

const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567';

try {
    const metadata = await client.inspect({ magnet });

    console.log(metadata.name);
    console.log(metadata.files);

    const torrent = await client.download({ meta: metadata });

    torrent.on('progress', (progress) => {
        console.log(`${(progress.percent * 100).toFixed(2)}%`, progress.speed);
    });

    await torrent.done;
} finally {
    client.close();
}
```

Supported magnet fields:

- `xt=urn:btih:<infoHash>`: required. Hex-encoded 40-character info hashes and base32 32-character info hashes are supported.
- `dn`: optional display name.
- `tr`: optional tracker URL. Multiple `tr` parameters are supported, but trackerless magnets can resolve through DHT.

The default DHT node is in-memory. It keeps a routing table and a short-lived peer cache for the current process, so a magnet `inspect()` can populate peers that a later `download({ meta })` call can reuse on the same `Client` instance. The DHT state is not persisted to disk.

## Download Options

```ts
const torrent = await client.download(
    {
        torrentFile: './example.torrent',
    },
    {
        outputDirectory: './downloads',
        targetConnections: 50,
        maxConnecting: 100,
        minConnections: 5,
        announcePort: 6881,
        seed: false,
        progressEvents: 'block',
        onChangeState: (state) => {
            console.log('client state:', state);
        },
    },
);
```

Download options:

- `outputDirectory`: override the output directory for this download.
- `files`: download only selected files.
- `targetConnections`: override the preferred peer connection count.
- `minConnections`: minimum connectable peer count requested before downloading starts.
- `maxConnecting`: override simultaneous peer connection attempts.
- `peerConnectTimeoutMs`: override peer connection timeout.
- `trackerTimeoutMs`: override tracker announce timeout.
- `announcePort`: port sent to trackers in announce requests.
- `maxInFlightRequestsPerPeer`: override request concurrency per peer.
- `requestTimeoutMs`: override block request timeout.
- `seed`: reserved for future seeding support. Currently only `false` is supported.
- `progressEvents`: `'piece'` or `'block'`.
- `speedSampleIntervalMs`: override speed sample interval.
- `onChangeState`: receives client setup states: `parsing`, `tracking`, `connecting`, `downloading`.

Tracker announce failures are treated as non-fatal. If trackers are missing or do not return peers, the client falls back to DHT when it is enabled. With DHT disabled, the client can still continue with an empty peer list instead of throwing during tracking when `minConnections` is `0`.

## Selecting Files

For multi-file torrents, pass `files` to download only specific files. A file can be selected by its slash-joined path string or by its torrent path array.

```ts
const metadata = await client.inspect({
    torrentFile: './big-buck-bunny.torrent',
});

console.log(metadata.files);

const torrent = await client.download(
    {
        torrentFile: './big-buck-bunny.torrent',
    },
    {
        outputDirectory: './downloads',
        files: ['Big Buck Bunny.mp4'],
    },
);

console.log(torrent.files);
await torrent.done;
```

`torrent.files` separates the selected files from the skipped files:

```ts
{
    included: [
        { path: ['Big Buck Bunny.mp4'], length: 276134947, offset: 140 },
    ],
    excluded: [
        { path: ['Big Buck Bunny.en.srt'], length: 140, offset: 0 },
        { path: ['poster.jpg'], length: 310380, offset: 276135087 },
    ],
}
```

Passing `files: null` or omitting `files` downloads everything.

## Torrent Events

```ts
torrent.on('state', ({ previous, state }) => {
    console.log(previous, '->', state);
});

torrent.on('progress', (progress) => {
    console.log(progress.percent, progress.speed);
});

torrent.on('peer', (stats) => {
    console.log('peer connected', stats.connections, '/', stats.targetConnections);
});

torrent.on('done', () => {
    console.log('done');
});

torrent.on('error', (error) => {
    console.error(error);
});

torrent.on('close', () => {
    console.log('closed');
});
```

The current torrent state is also available through `torrent.state`. Possible states are:

- `downloading`
- `completed`
- `failed`
- `closed`

When a download completes, `torrent.done` resolves, the state becomes `completed`, and internal peer connections are closed automatically because seeding is not implemented yet. Call `torrent.close()` to stop an active download early or to mark a completed torrent as explicitly closed.

## Progress Shape

Progress events and `torrent.progress` expose:

```ts
{
    totalBytes: number;
    receivedBytes: number;
    downloadedBytes: number;
    totalPieces: number;
    completedPieces: number;
    percent: number;
    speedBytesPerSecond: number;
    speed: string;
}
```

`receivedBytes` counts received piece data, while `downloadedBytes` counts completed and hash-validated pieces.

## License

MIT
