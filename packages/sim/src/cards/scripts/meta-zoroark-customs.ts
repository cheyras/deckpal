/**
 * Bespoke effects for lane "zoroark" cards (see meta-zoroark.ts). Each is registered by
 * name and called from a script as `{ op: 'custom', fn: '<name>', args }`.
 * Tested through the cards that use them (src/__tests__/cards-meta-zoroark.test.ts).
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { findSlot, topCard } from '../../state.js';

function first(v: unknown): number | undefined {
  return Array.isArray(v) ? (v[0] as number | undefined) : typeof v === 'number' ? v : undefined;
}

/**
 * N's Zoroark ex, Night Joker: "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack."
 * `useAttackOf` takes a card; this puts the Pokémon card on top of the chosen slot (args.from) into args.as.
 */
registerCustom('slotTopCard', (env, s, f, args) => {
  const id = first(f.vars[String(args.from)]);
  const sl = id === undefined ? undefined : findSlot(s, id)?.slot;
  const card = sl ? topCard(sl) : undefined;
  // Loop guard: inside an attack that is itself a copy, a Pokémon with the same name as the copied card would
  // copy the same attack again (two Benched N's Zoroark ex copying each other's Night Joker forever), so it
  // copies nothing.
  const loop = card !== undefined && String(f.code).endsWith(':copy') && def(env.ctx, card).name === def(env.ctx, f.src).name;
  f.vars[String(args.as)] = card !== undefined && !loop ? [card] : [];
  return 'next';
});

/**
 * Transformation Tome: "Choose a Basic Pokémon in your discard pile and switch it with 1 of your Basic Pokémon
 * in play. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain
 * on the new Pokémon."
 * args: { card, slot } — the discard card variable and the chosen slot variable. The slot keeps its id, so its
 * Energy, Tools, damage, conditions, entered turn and slot-bound timed effects stay; only the card changes.
 */
registerCustom('swapBasicFromDiscard', (_env, s, f, args) => {
  const ps = s.p[f.player];
  const card = first(f.vars[String(args.card)]);
  const id = first(f.vars[String(args.slot)]);
  if (card === undefined || id === undefined) return 'next';
  const sl = findSlot(s, id)?.slot;
  const i = ps.discard.indexOf(card);
  if (!sl || sl.cards.length !== 1 || i < 0) return 'next';
  ps.discard.splice(i, 1);
  const old = sl.cards[0] as number;
  sl.cards = [card];
  ps.discard.push(old);
  return 'next';
});
