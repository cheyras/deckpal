/**
 * Extra frame snapshots, one generated file per card lane, so parallel lanes
 * never edit the same file. Each lane: `node scripts/fetch-frames.mjs --out src/cards/frames-extra/<lane>.ts <ids…>`
 * then add its import and spread below (one line each).
 */
import type { CardFrame } from '../../types.js';
import { FRAMES as BLAZIKEN } from './blaziken.js';
import { FRAMES as CHARIZARD } from './charizard.js';
import { FRAMES as DARKRAI } from './darkrai.js';
import { FRAMES as EXCADRILL } from './excadrill.js';
import { FRAMES as GRIMMSNARL } from './grimmsnarl.js';
import { FRAMES as TREVENANT } from './trevenant.js';
import { FRAMES as ZOROARK } from './zoroark.js';

export const EXTRA_FRAMES: Record<string, CardFrame> = {
  ...BLAZIKEN,
  ...CHARIZARD,
  ...DARKRAI,
  ...EXCADRILL,
  ...GRIMMSNARL,
  ...TREVENANT,
  ...ZOROARK,
};
