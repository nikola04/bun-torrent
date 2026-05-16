import type { TorrentMetadata } from '../types';
import type { PiecePlanner, PiecePlannerOptions } from './types';
import { DefaultPiecePlanner } from './DefaultPlanner';

/**
 * Create the default mutable piece planner for torrent download scheduling.
 *
 * @param metadata - Parsed torrent metadata containing piece hashes and sizing information.
 * @param options - Planner configuration such as block size.
 * @returns A planner that can schedule block requests and assemble completed pieces.
 * @throws {PiecePlannerError} When metadata implies invalid piece or block sizing.
 */
export const createPiecePlanner = (
    metadata: TorrentMetadata,
    options: PiecePlannerOptions = {},
): PiecePlanner => new DefaultPiecePlanner(metadata, options);
