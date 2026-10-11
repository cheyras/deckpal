/**
 * Bespoke conditions for the "std-c18" batch (std-c18.ts). Names are prefixed `c18.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c18.test.ts.
 */
import { def } from '../../context.js';
import { registerCustomCond } from '../../customs.js';
import { allSlots, opp, topCard } from '../../state.js';

/**
 * Enamorus, Love Resonance: "If any of your Pokémon in play are the same type as any of your opponent's Pokémon in play"
 * -- true when some Pokémon of the controller (Active or Benched) and some Pokémon of the opponent (Active or Benched)
 * have at least one type in common.
 */
registerCustomCond('c18.sharesTypeWithOpp', (env, s, ec) => {
  const mine = allSlots(s.p[ec.player]).flatMap((sl) => def(env.ctx, topCard(sl)).types as string[]);
  if (mine.length === 0) return false;
  return allSlots(s.p[opp(ec.player)]).some((sl) => (def(env.ctx, topCard(sl)).types as string[]).some((t) => mine.includes(t)));
});
