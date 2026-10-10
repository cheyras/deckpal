/**
 * Extra frame snapshots, one generated file per card lane, so parallel lanes
 * never edit the same file. Each lane: `node scripts/fetch-frames.mjs --out src/cards/frames-extra/<lane>.ts <ids…>`
 * then add its import and spread below (one line each).
 */
import type { CardFrame } from '../../types.js';
import { FRAMES as EXCADRILL } from './excadrill.js';

export const EXTRA_FRAMES: Record<string, CardFrame> = {
  ...EXCADRILL,
};
