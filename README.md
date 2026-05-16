# bun-torrent

A minimal Bun-native BitTorrent download-only client written in TypeScript.

`bun-torrent` can parse `.torrent` files, announce to HTTP and UDP trackers, connect to peers, download pieces, validate piece hashes, and write the downloaded files to disk. The public API is intentionally small: create a `Client`, inspect a torrent when you need metadata, then call `download()`.

It has no runtime dependencies.

> This package is currently beta software. The API can still change before a stable release.

## Requirements

- Bun `>= 1.3.0`

## Installation

```bash
bun add bun-torrent@beta
```

or:

```bash
npm install bun-torrent@beta
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

## Client Setup

```ts
import { Client } from 'bun-torrent';

const client = new Client({
    outputDirectory: './downloads',
    maxInFlightRequestsPerPeer: 20,
    requestTimeoutMs: 15_000,
    progressEvents: 'piece',
    speedSampleIntervalMs: 500,
});
```

Client options:

- `outputDirectory`: directory where downloaded files are written. Defaults to `process.cwd()`.
- `files`: optional default file selection for downloads.
- `maxInFlightRequestsPerPeer`: maximum active block requests per peer. Defaults to `20`.
- `requestTimeoutMs`: timeout for an individual block request. Defaults to `15000`.
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

## Download Options

```ts
const torrent = await client.download(
    {
        torrentFile: './example.torrent',
    },
    {
        outputDirectory: './downloads',
        minConnections: 5,
        announcePort: 6881,
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
- `minConnections`: minimum connectable peer count requested before downloading starts.
- `announcePort`: port sent to trackers in announce requests.
- `maxInFlightRequestsPerPeer`: override request concurrency per peer.
- `requestTimeoutMs`: override block request timeout.
- `progressEvents`: `'piece'` or `'block'`.
- `speedSampleIntervalMs`: override speed sample interval.
- `onChangeState`: receives client setup states: `parsing`, `tracking`, `connecting`, `downloading`.

Tracker announce failures are treated as non-fatal. If no tracker responds, the client can still continue with an empty peer list instead of throwing during tracking.

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

torrent.on('peer', (peer) => {
    console.log('peer connected', peer);
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

Call `torrent.close()` to stop the download and close peer connections.

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
