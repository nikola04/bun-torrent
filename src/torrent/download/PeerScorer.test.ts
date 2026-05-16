import { describe, expect, test } from 'bun:test';

import { PeerScorer, type PeerDownloadStats } from './PeerScorer';

const makeStats = (overrides: Partial<PeerDownloadStats> = {}): PeerDownloadStats => ({
    receivedBytes: 0,
    receivedBlocks: 0,
    timedOutRequests: 0,
    sentRequests: 0,
    completedPieces: 0,
    invalidPieces: 0,
    lastBlockAt: null,
    totalRequestTimeMs: 0,
    completedRequests: 0,
    ...overrides,
});

describe('PeerScorer', () => {
    test('rewards completed pieces and received bytes', () => {
        const scorer = new PeerScorer();

        const slow = scorer.getScore(
            makeStats({
                completedPieces: 1,
                completedRequests: 1,
                receivedBytes: 1_000,
                totalRequestTimeMs: 1_000,
            }),
        );
        const fast = scorer.getScore(
            makeStats({
                completedPieces: 2,
                completedRequests: 2,
                receivedBytes: 10_000,
                totalRequestTimeMs: 500,
            }),
        );

        expect(fast).toBeGreaterThan(slow);
    });

    test('penalizes timeouts and invalid pieces', () => {
        const scorer = new PeerScorer();
        const baseline = scorer.getScore(
            makeStats({
                completedPieces: 2,
                completedRequests: 2,
                receivedBytes: 10_000,
                totalRequestTimeMs: 500,
            }),
        );
        const penalized = scorer.getScore(
            makeStats({
                completedPieces: 2,
                completedRequests: 2,
                invalidPieces: 1,
                receivedBytes: 10_000,
                timedOutRequests: 1,
                totalRequestTimeMs: 500,
            }),
        );

        expect(penalized).toBeLessThan(baseline);
    });

    test('reduces request limits for peers with repeated timeouts', () => {
        const scorer = new PeerScorer();

        expect(scorer.getRequestLimit(makeStats(), 20)).toBe(20);
        expect(scorer.getRequestLimit(makeStats({ timedOutRequests: 3 }), 20)).toBe(1);
        expect(
            scorer.getRequestLimit(
                makeStats({
                    completedRequests: 4,
                    sentRequests: 8,
                    timedOutRequests: 3,
                }),
                20,
            ),
        ).toBe(10);
        expect(
            scorer.getRequestLimit(
                makeStats({
                    completedRequests: 4,
                    sentRequests: 8,
                    timedOutRequests: 5,
                }),
                20,
            ),
        ).toBe(5);
    });
});
