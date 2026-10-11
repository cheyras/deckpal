/** Every card script, by era and lane. Regenerated from the lane files on disk. */
import type { CardScript } from '../../dsl.js';
import { SV } from './sv.js';
import { ME } from './me.js';
import { GHOST } from './ghost.js';
import { FIGHTING } from './fighting.js';
import { METAL } from './metal.js';
import { MISC } from './misc.js';
import { META_BLAZIKEN } from './meta-blaziken.js';
import { META_CHARIZARD } from './meta-charizard.js';
import { META_DARKRAI } from './meta-darkrai.js';
import { META_EXCADRILL } from './meta-excadrill.js';
import { META_GRIMMSNARL } from './meta-grimmsnarl.js';
import { META_TREVENANT } from './meta-trevenant.js';
import { META_ZOROARK } from './meta-zoroark.js';
import { OPP } from './opp.js';
import { STD_GEN } from './std-gen.js';
import { STD_H01 } from './std-h01.js';
import { STD_SEED1 } from './std-seed1.js';
import { STD_SEED2 } from './std-seed2.js';
import { STD_SEED3 } from './std-seed3.js';
import { STD_SEED4 } from './std-seed4.js';
import { STD_C06 } from './std-c06.js';

export const SCRIPTS: CardScript[] = [...SV, ...ME, ...GHOST, ...FIGHTING, ...METAL, ...MISC, ...META_BLAZIKEN, ...META_CHARIZARD, ...META_DARKRAI, ...META_EXCADRILL, ...META_GRIMMSNARL, ...META_TREVENANT, ...META_ZOROARK, ...OPP, ...STD_GEN, ...STD_H01, ...STD_SEED1, ...STD_SEED2, ...STD_SEED3, ...STD_SEED4, ...STD_C06];
