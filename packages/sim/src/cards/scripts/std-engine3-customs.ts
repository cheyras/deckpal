/**
 * Bespoke effects for the "std-engine3" batch (std-engine3.ts). Tests: src/__tests__/cards-std-engine3.test.ts.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { effectsPrevented } from '../../query.js';
import { allSlots, emit, opp } from '../../state.js';
import type { Player } from '../../types.js';

/**
 * Mega Dragalge ex, Corrosive Liquid: "Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon."
 * Every Pokémon of the opponent, Active and Benched: its Tools and its attached Special Energy go to their owner's discard
 * pile (Basic Energy stays). A Pokémon that is protected from the effects of attacks (Mist Energy, Hide 'n' Sneak) is left alone.
 */
registerCustom('engine3.discardOppToolsAndSpecial', (env, s, f) => {
  for (const sl of allSlots(s.p[opp(f.player)])) {
    if (f.kind === 'attack' && effectsPrevented(env, s, sl, f.player, 'attack')) continue;
    const gone = [...sl.tools, ...sl.energy.filter((c) => def(env.ctx, c).basicEnergy === false)];
    if (!gone.length) continue;
    sl.tools = [];
    sl.energy = sl.energy.filter((c) => !gone.includes(c));
    for (const c of gone) {
      const owner = env.ctx.owner[c] as Player;
      s.p[owner].discard.push(c);
      emit(env, { type: 'discard', player: owner, cards: [c] });
    }
  }
  return 'next';
});
