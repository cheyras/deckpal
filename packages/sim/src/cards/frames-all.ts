/** Every snapshotted frame: the base file (frames.ts) plus the per-lane extras. */
import { FRAMES as BASE } from './frames.js';
import { EXTRA_FRAMES } from './frames-extra/index.js';
import type { CardFrame } from '../types.js';

import { withPrintedWR } from './printed-wr.js';
import { withEvolvesFrom } from './evolves-from.js';
import { withCleanText } from './clean-text.js';

const RAW: Record<string, CardFrame> = { ...BASE, ...EXTRA_FRAMES };

/** Every snapshotted frame with its printed Weakness/Resistance filled in where the catalog lacks them. */
export const FRAMES: Record<string, CardFrame> = Object.fromEntries(Object.entries(RAW).map(([id, f]) => [id, withPrintedWR(withEvolvesFrom(withCleanText(f)))]));
