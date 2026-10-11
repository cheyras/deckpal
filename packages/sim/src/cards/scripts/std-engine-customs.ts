/**
 * Bespoke effects for the "std-engine" batch (std-engine.ts). Tests: src/__tests__/cards-std-engine.test.ts.
 */
import { registerCustom } from '../../customs.js';
import { resolveSlot } from '../../eval.js';
import { ec } from '../../interp.js';
import { effectsPrevented, ownerOf } from '../../query.js';
import { allSlots, emit, slotCards } from '../../state.js';

/**
 * Jynx, Intense Kiss: "discard the Defending Pokémon and all attached cards."
 * The Defending Pokémon (the frame's `defender`) leaves play with every card on it (evolution stack, Energy, Tools) and all of
 * them go to its owner's discard pile. This is not a Knock Out: no Prize cards. A Pokémon protected from the effects of
 * attacks is left alone. If it was the Active Pokémon, its owner promotes a new one when Knock Outs are next checked.
 */
registerCustom('stdEngine.discardDefender', (env, s, f) => {
  const t = resolveSlot(s, ec(f), 'defender');
  if (!t) return 'next';
  const owner = ownerOf(s, t);
  if (f.kind === 'attack' && owner !== f.player && effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
  const ps = s.p[owner];
  if (!allSlots(ps).includes(t)) return 'next';
  if (ps.active === t) ps.active = null;
  else ps.bench = ps.bench.filter((b) => b !== t);
  s.effects = s.effects.filter((x) => x.slot !== t.id);
  if (s.delayed?.length) s.delayed = s.delayed.filter((d) => d.slot !== t.id);
  const cards = slotCards(t);
  ps.discard.push(...cards);
  emit(env, { type: 'discard', player: owner, cards });
  return 'next';
});
