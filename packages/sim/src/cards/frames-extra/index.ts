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
import { FRAMES as REPLAY } from './replay.js';
import { FRAMES as STANDARD } from './standard.js';
import { FRAMES as STD_30A } from './std-30a.js';
import { FRAMES as STD_30B } from './std-30b.js';
import { FRAMES as STD_30C } from './std-30c.js';
import { FRAMES as STD_30D } from './std-30d.js';
import { FRAMES as STD_NEW } from './std-new.js';
import { FRAMES as TREVENANT } from './trevenant.js';
import { FRAMES as ZOROARK } from './zoroark.js';

export const EXTRA_FRAMES: Record<string, CardFrame> = {
  ...BLAZIKEN,
  ...CHARIZARD,
  ...DARKRAI,
  ...EXCADRILL,
  ...GRIMMSNARL,
  ...REPLAY,
  ...STANDARD,
  ...STD_30A,
  ...STD_30B,
  ...STD_30C,
  ...STD_30D,
  ...STD_NEW,
  ...TREVENANT,
  ...ZOROARK,
};
