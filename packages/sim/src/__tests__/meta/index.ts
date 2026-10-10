/**
 * Current-meta gauntlet lists (beyond the owner's account), one file per
 * archetype lane: export a `[cardId, count][]` list and add it here (one line each).
 */
import { LIST as BLAZIKEN } from './blaziken.js';
export const META_LISTS: Record<string, [string, number][]> = {
  'Dragapult ex / Blaziken ex': BLAZIKEN,
};
