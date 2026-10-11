/**
 * Current-meta gauntlet lists (beyond the owner's account), one file per
 * archetype lane: export a `[cardId, count][]` list and add it here (one line each).
 */
import { LIST as BLAZIKEN } from './blaziken.js';
import { LIST as CHARIZARD } from './charizard.js';
import { LIST as DARKRAI } from './darkrai.js';
import { LIST as EXCADRILL } from './excadrill.js';
import { LIST as GRIMMSNARL } from './grimmsnarl.js';
import { LIST as TREVENANT } from './trevenant.js';
import { LIST as ZOROARK } from './zoroark.js';

export const META_LISTS: Record<string, [string, number][]> = {
  'Dragapult ex / Blaziken ex': BLAZIKEN,
  'Mega Charizard X ex / Oricorio ex': CHARIZARD,
  'Mega Darkrai ex': DARKRAI,
  'Mega Excadrill ex': EXCADRILL,
  'Grimmsnarl ex / Froslass': GRIMMSNARL,
  "Hop's Trevenant": TREVENANT,
  "N's Zoroark ex": ZOROARK,
};
