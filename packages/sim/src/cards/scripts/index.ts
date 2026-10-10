/** Every card script, by era and gauntlet lane. Add new files here. */
import type { CardScript } from '../../dsl.js';
import { FIGHTING } from './fighting.js';
import { GHOST } from './ghost.js';
import { ME } from './me.js';
import { META_ZOROARK } from './meta-zoroark.js';
import { METAL } from './metal.js';
import { MISC } from './misc.js';
import { SV } from './sv.js';

export const SCRIPTS: CardScript[] = [...SV, ...ME, ...GHOST, ...FIGHTING, ...METAL, ...MISC, ...META_ZOROARK];
