/**
 * Bespoke effects for the "std-engine7" batch (std-engine7.ts). Names are prefixed `engine7.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-engine7.test.ts.
 */
import { registerCustom } from '../../customs.js';
import { findSlot, takeFromZones, topCard } from '../../state.js';

/**
 * Palafin, Zero to Hero: "... you may search your deck for a Palafin ex and switch it with this Pokémon. Any attached cards, damage
 * counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way,
 * put this card into your deck."
 *
 * args: { cards: variable holding the card found }. The found card takes the place of this Pokémon's top card (the slot, and so
 * everything attached to it and every effect on it, stays; the cards underneath stay too: Finizen goes under the Palafin ex, TPCi Rules
 * Team 2024-05-23, ruling 1977), and the card it replaces goes into the deck (the program shuffles right after). Nothing happens
 * without a card found, or if this Pokémon is no longer in play.
 */
registerCustom('engine7.swapTopCard', (_env, s, f, args) => {
  const loc = findSlot(s, f.slot);
  const v = f.vars[String(args.cards)];
  const found = Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined;
  if (!loc || found === undefined) return 'next';
  const ps = s.p[loc.owner];
  if (!takeFromZones(ps, found)) return 'next';
  const old = topCard(loc.slot);
  loc.slot.cards[loc.slot.cards.length - 1] = found;
  ps.deck.push(old);
  return 'next';
});
