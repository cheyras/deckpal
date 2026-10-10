/**
 * Bespoke effects for the "fighting" gauntlet lane, registered into customs.ts.
 * Each is written from the printed text quoted above it and tested in
 * src/__tests__/cards-fighting.test.ts.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter, SlotZone } from '../../dsl.js';
import { cardMatches, resolveSlot, slotMatches, slotsIn, type EvalCtx } from '../../eval.js';
import { effectsPrevented } from '../../query.js';
import { emit, shuffleDeck } from '../../state.js';
import type { Frame } from '../../types.js';

function ctxOf(f: Frame): EvalCtx {
  return { player: f.player, slot: f.slot, defender: (f.vars.__def as number) || 0, vars: f.vars };
}

/**
 * Claydol, Devolution Ray: "If your opponent's Active Pokémon is an evolved Pokémon, devolve it by putting the
 * highest Stage Evolution card on it into your opponent's hand."
 * Devolving, like evolving, clears Special Conditions and the effects of attacks on that Pokémon.
 */
registerCustom('devolveDefender', (env, s, f) => {
  const t = resolveSlot(s, ctxOf(f), 'defender');
  if (!t || t.cards.length < 2) return 'next';
  const owner = s.p[0].active === t || s.p[0].bench.includes(t) ? 0 : 1;
  if (owner === f.player || s.p[owner].active !== t) return 'next';
  if (effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
  const card = t.cards.pop() as number;
  const ps = s.p[owner];
  ps.hand.push(card);
  ps.revealed.push(card); // both players saw it leave play
  t.cond = 0;
  s.effects = s.effects.filter((x) => !(x.slot === t.id && x.fromAttack));
  return 'next';
});

/** Sum of damage counters on the controller-relative zone's Pokémon matching `filter`, into variable `as`. */
registerCustom('sumCounters', (env, s, f, args) => {
  const zone = String(args.zone) as SlotZone;
  const filter = args.filter as Filter | undefined;
  const n = slotsIn(s, f.player, zone)
    .filter((sl) => slotMatches(env, sl, filter))
    .reduce((a, sl) => a + sl.damage / 10, 0);
  f.vars[String(args.as ?? 'n')] = n;
  return 'next';
});

/**
 * Pokégear 3.0: "Look at the top 7 cards of your deck. You may reveal a Supporter card you find there and put it
 * into your hand. Shuffle the other cards back into your deck."
 * args: { n, filter, max } — the top n cards; up to `max` (default 1) matching cards to hand; then shuffle.
 */
registerCustom('lookAtTopTake', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const n = Number(args.n ?? 7);
  const max = Number(args.max ?? 1);
  const filter = args.filter as Filter | undefined;
  const take = (cards: number[]): 'next' => {
    for (const c of cards) {
      const i = ps.deck.indexOf(c);
      if (i < 0) continue;
      ps.deck.splice(i, 1);
      ps.hand.push(c);
      ps.revealed.push(c);
    }
    if (cards.length) emit(env, { type: 'search', player: f.player, found: cards.slice() });
    shuffleDeck(env, s, f.player);
    return 'next';
  };
  if (answer !== undefined) return take(answer as number[]);
  const top = ps.deck.slice(Math.max(0, ps.deck.length - n));
  const opts = top.filter((c) => cardMatches(env, c, filter));
  if (!opts.length) return take([]);
  s.pending = {
    decision: {
      player: f.player,
      kind: 'cards',
      prompt: `Put up to ${max} of these into your hand (${def(env.ctx, f.src).name})`,
      min: 0,
      max: Math.min(max, opts.length),
      values: opts,
    },
    resume: { k: 'frame', as: '__a', mode: 'cards' },
  };
  return 'wait';
});
