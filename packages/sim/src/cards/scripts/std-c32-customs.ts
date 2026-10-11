/**
 * Bespoke effects for the "std-c32" batch (std-c32.ts). Names are prefixed `c32.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c32.test.ts.
 */
import { registerCustom } from '../../customs.js';
import { emit, findSlot } from '../../state.js';

/**
 * Misty's Psyduck, Flustered Leap: "Once during your turn, if this Pokémon is on your Bench, you may discard the bottom card of your
 * deck. If you do, discard all cards from this Pokémon and put this Pokémon on top of your deck."
 * Nothing happens when the deck is empty (there is no bottom card to discard, so "if you do" fails). Otherwise the bottom card of
 * the controller's deck goes to the discard pile, every Energy and Tool on this Pokémon is discarded, and the Pokémon card itself
 * (its whole stack, though a Psyduck that has evolved no longer has this Ability) is put on top of the deck. It is not a Knock Out
 * and the deck is not shuffled. Timed effects bound to the Pokémon end.
 */
registerCustom('c32.flusteredLeap', (env, s, f) => {
  const loc = findSlot(s, f.slot);
  if (!loc || loc.owner !== f.player) return 'next';
  const ps = s.p[loc.owner];
  if (ps.active === loc.slot || !ps.bench.includes(loc.slot) || !ps.deck.length) return 'next';
  const bottom = ps.deck.shift() as number; // index 0 is the bottom of the deck
  const gone = [bottom, ...loc.slot.energy, ...loc.slot.tools];
  ps.discard.push(...gone);
  emit(env, { type: 'discard', player: loc.owner, cards: gone });
  ps.bench = ps.bench.filter((b) => b !== loc.slot);
  s.effects = s.effects.filter((x) => x.slot !== loc.slot.id);
  if (s.delayed?.length) s.delayed = s.delayed.filter((d) => d.slot !== loc.slot.id);
  ps.deck.push(...loc.slot.cards); // the top of the deck is the end of the list
  return 'next';
});
