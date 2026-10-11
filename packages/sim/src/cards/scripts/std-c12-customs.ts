/**
 * Bespoke effects for the "std-c12" batch (std-c12.ts). Names are prefixed `c12.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c12.test.ts.
 */
import { registerCustom, registerCustomCond } from '../../customs.js';
import { maxHp } from '../../query.js';
import { findSlot } from '../../state.js';

/**
 * Misty's Vitality / Celebratory Fanfare: "Your turn ends." / "If a player healed any damage in this way, their turn ends."
 * The turn ends the way it does after an attack: the main phase sees the flag, resolves Knock Outs and goes to the end of
 * the turn (no attack happens, so no attack effects run and nothing is recorded as damaged by an attack).
 */
registerCustom('c12.endTurn', (_env, s) => {
  s.attacked = true;
  return 'next';
});

/**
 * Weavile, Retaliatory Claw: "If this Pokémon's remaining HP is 50 or less". args: { n }. True when the source Pokémon's
 * HP (printed plus any HP changes) minus its damage is at most n.
 */
registerCustomCond('c12.remainingHpAtMost', (env, s, ec, args) => {
  const loc = findSlot(s, ec.slot);
  if (!loc) return false;
  return maxHp(env, s, loc.slot) - loc.slot.damage <= Number(args.n ?? 50);
});
