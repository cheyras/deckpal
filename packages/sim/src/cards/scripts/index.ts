/** Every card script, by era. Add new files here. */
import type { CardScript } from '../../dsl.js';
import { ME } from './me.js';
import { SV } from './sv.js';

export const SCRIPTS: CardScript[] = [...SV, ...ME];
