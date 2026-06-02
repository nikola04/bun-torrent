/**
 * Base class for every error thrown by `bun-torrent`.
 *
 * Each subsystem extends this with a narrower `code` enum (e.g. {@link ClientError},
 * {@link TrackerError}, {@link DHTError}). Use `instanceof BunTorrentError` to detect
 * any library-originated error, or `instanceof <Specific>Error` plus the `code` field
 * for fine-grained handling.
 *
 * @example
 * try {
 *     await client.download({ torrentFile: './x.torrent' });
 * } catch (err) {
 *     if (err instanceof BunTorrentError) console.error(err.code, err.message);
 *     else throw err;
 * }
 */
export class BunTorrentError extends Error {
    constructor(
        message: string,
        /** Machine-readable error code. Each subclass narrows this to a specific enum. */
        public readonly code: string,
    ) {
        super(message);
        this.name = new.target.name;
    }
}
