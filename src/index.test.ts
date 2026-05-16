import { expect, test } from 'bun:test';

import * as api from './index';

test('public entrypoint loads', () => {
    expect(api).toBeDefined();
});

test('public entrypoint exposes the stable client API', () => {
    expect(api).toHaveProperty('Client');
    expect(api).toHaveProperty('Torrent');
    expect(api).toHaveProperty('TorrentState');
    expect(api).toHaveProperty('DEFAULT_CLIENT_CONFIG');
    expect(api).toHaveProperty('ClientError');
    expect(api).toHaveProperty('BunTorrentError');
});

test('public entrypoint does not expose protocol internals', () => {
    expect(api).not.toHaveProperty('PeerSession');
    expect(api).not.toHaveProperty('PeerPool');
    expect(api).not.toHaveProperty('encodePeerMessage');
    expect(api).not.toHaveProperty('decodePeerMessage');
    expect(api).not.toHaveProperty('encodeHandshake');
    expect(api).not.toHaveProperty('DownloadManager');
});
