/**
 * Current-meta gauntlet lists (beyond the owner's account), one file per
 * archetype lane: export a `[cardId, count][]` list and add it here (one line each).
 */
import { LIST as EXCADRILL } from './excadrill.js';

export const META_LISTS: Record<string, [string, number][]> = {
  'Mega Excadrill ex': EXCADRILL,
};
