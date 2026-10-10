/** Every snapshotted frame: the base file (frames.ts) plus the per-lane extras. */
import { FRAMES as BASE } from './frames.js';
import { EXTRA_FRAMES } from './frames-extra/index.js';
import type { CardFrame } from '../types.js';

export const FRAMES: Record<string, CardFrame> = { ...BASE, ...EXTRA_FRAMES };
