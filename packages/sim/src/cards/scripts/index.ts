/** Every card script, by era and lane. Regenerated from the lane files on disk. */
import type { CardScript } from '../../dsl.js';
import { SV } from './sv.js';
import { ME } from './me.js';
import { GHOST } from './ghost.js';
import { FIGHTING } from './fighting.js';
import { METAL } from './metal.js';
import { MISC } from './misc.js';
import { META_BLAZIKEN } from './meta-blaziken.js';
import { META_DARKRAI } from './meta-darkrai.js';
import { META_EXCADRILL } from './meta-excadrill.js';
import { META_GRIMMSNARL } from './meta-grimmsnarl.js';
import { META_TREVENANT } from './meta-trevenant.js';

export const SCRIPTS: CardScript[] = [...SV, ...ME, ...GHOST, ...FIGHTING, ...METAL, ...MISC, ...META_BLAZIKEN, ...META_DARKRAI, ...META_EXCADRILL, ...META_GRIMMSNARL, ...META_TREVENANT];
