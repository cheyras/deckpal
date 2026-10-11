/**
 * Bespoke conditions for the rulings audit, lane 04. Names are prefixed `rul04.`; each is exercised by src/__tests__/rulings-r04.test.ts.
 */
import { registerCustomCond } from '../../customs.js';

/**
 * Pyroar, Intimidating Fang (the part of the effect that is about damage done to the attacker's own Pokémon): true while it is the
 * turn of a player other than the controller, i.e. while the controller's opponent is the one attacking.
 */
registerCustomCond('rul04.opponentsTurn', (_env, s, ec) => s.current !== ec.player);
