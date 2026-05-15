import { describe, expect, test } from 'bun:test';

import type { TorrentMetadata } from '@torrent/types';
import { trackPeers, TrackerError, TrackerErrorCode } from './index';
import type { AnnounceOptions } from './types';

const peerId = new Uint8Array(20);

const makeMeta = ({
    announce,
    announceList = [],
}: {
    announce?: string;
    announceList?: string[][];
} = {}): TorrentMetadata => ({
    announce,
    announceList,
    infoHash: new Uint8Array(20),
    name: 'file.bin',
    pieceLength: 16_384,
    pieces: [new Uint8Array(20)],
    length: 12_345,
    files: [{ path: ['file.bin'], length: 12_345, offset: 0 }],
});

describe('trackPeers', () => {
    test('rejects when there are no supported trackers', async () => {
        await expect(
            trackPeers({
                meta: makeMeta({
                    announce: 'wss://tracker.test/announce',
                    announceList: [['ftp://backup.test/announce']],
                }),
                peerId,
            }),
        ).rejects.toMatchObject({
            code: TrackerErrorCode.NO_SUPPORTED_TRACKERS,
        });
    });

    test('rejects with announce failure causes when all trackers fail', async () => {
        const causes = [new Error('dns failed'), new Error('timeout')];
        const calls: string[] = [];

        try {
            await trackPeers({
                meta: makeMeta({
                    announce: 'udp://tracker-a.test:80/announce',
                    announceList: [['https://tracker-b.test/announce']],
                }),
                peerId,
                udp: async (tracker) => {
                    calls.push(tracker);
                    throw causes[0];
                },
                http: async (tracker) => {
                    calls.push(tracker);
                    throw causes[1];
                },
            });
            throw new Error('Expected trackPeers to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(TrackerError);
            expect((error as TrackerError).code).toBe(TrackerErrorCode.ANNOUNCE_FAILED);
            expect((error as TrackerError).causes).toEqual(causes);
            expect(calls).toEqual([
                'udp://tracker-a.test:80/announce',
                'https://tracker-b.test/announce',
            ]);
        }
    });

    test('rejects with no peers when trackers respond without peers', async () => {
        const causes = [
            new TrackerError(TrackerErrorCode.NO_PEERS, 'Tracker returned no peers'),
            new TrackerError(TrackerErrorCode.NO_PEERS, 'Tracker returned no peers'),
        ];
        let callCount = 0;

        await expect(
            trackPeers({
                meta: makeMeta({
                    announce: 'udp://tracker-a.test:80/announce',
                    announceList: [['udp://tracker-b.test:80/announce']],
                }),
                peerId,
                udp: async () => {
                    throw causes[callCount++];
                },
            }),
        ).rejects.toMatchObject({
            code: TrackerErrorCode.NO_PEERS,
            causes,
        });
    });

    test('dedupes peers from successful trackers', async () => {
        const peers = await trackPeers({
            meta: makeMeta({
                announce: 'udp://tracker-a.test:80/announce',
                announceList: [['https://tracker-b.test/announce']],
            }),
            peerId,
            udp: async () => [
                { ip: '127.0.0.1', port: 6881 },
                { ip: '127.0.0.1', port: 6881 },
            ],
            http: async () => [
                { ip: '127.0.0.1', port: 6881 },
                { ip: '127.0.0.2', port: 6881 },
            ],
        });

        expect(peers).toEqual([
            { ip: '127.0.0.1', port: 6881 },
            { ip: '127.0.0.2', port: 6881 },
        ]);
    });

    test('passes announcePort separately from tracker URL ports', async () => {
        const optionsSeen: AnnounceOptions[] = [];

        const peers = await trackPeers({
            meta: makeMeta({
                announce: 'udp://tracker-a.test:6969/announce',
                announceList: [['https://tracker-b.test:443/announce']],
            }),
            peerId,
            announcePort: 51413,
            udp: async (_tracker, _meta, _peerId, options) => {
                optionsSeen.push(options ?? {});
                return [{ ip: '127.0.0.1', port: 6881 }];
            },
            http: async (_tracker, _meta, _peerId, options) => {
                optionsSeen.push(options ?? {});
                return [{ ip: '127.0.0.2', port: 6881 }];
            },
        });

        expect(peers).toHaveLength(2);
        expect(optionsSeen.map((options) => options.announcePort)).toEqual([51413, 51413]);
    });

    test('rejects invalid announce ports', async () => {
        await expect(
            trackPeers({
                meta: makeMeta({ announce: 'udp://tracker.test:6969/announce' }),
                peerId,
                announcePort: 70_000,
            }),
        ).rejects.toMatchObject({
            code: TrackerErrorCode.INVALID_PORT,
        });
    });
});
