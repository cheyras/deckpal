/**
 * Bespoke effects for the "std-c21" batch (std-c21.ts). Names are prefixed `c21.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c21.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { registerCustom, registerCustomCond } from '../../customs.js';
import type { Filter } from '../../dsl.js';
import { cardMatches, resolveSlot } from '../../eval.js';
import { ec } from '../../interp.js';
import { maxHp, statics } from '../../query.js';
import { allSlots, opp, slotCards } from '../../state.js';
import type { Decision, GameState, Player, Slot } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/** The opponent's Benched Pokémon whose remaining HP (HP with any changes, minus damage) is at most `max`. */
function lowHpBench(env: Parameters<typeof maxHp>[0], s: GameState, who: Player, max: number): Slot[] {
  const all = statics(env, s);
  return s.p[opp(who)].bench.filter((b) => maxHp(env, s, b, all) - b.damage <= max);
}

/**
 * Ledian, Glittering Star Pattern: "... switch in 1 of your opponent's Benched Pokémon that has 90 HP or less remaining
 * to the Active Spot."  (the "can it be done" half). args: { max } (default 90). True when the controller's opponent
 * has a Benched Pokémon whose remaining HP is at most `max`.
 */
registerCustomCond('c21.oppBenchLowHp', (env, s, ec2, args) => lowHpBench(env, s, ec2.player, Number(args.max ?? 90)).length > 0);

/**
 * Ledian, Glittering Star Pattern (the choice half). args: { max, as } -- the controller picks 1 of the opponent's Benched
 * Pokémon with `max` HP or less remaining into variable `as` (an empty list when none qualifies; no question when only
 * one does). Nothing moves yet: the program's `switch` step does that.
 */
registerCustom('c21.pickOppBenchLowHp', (env, s, f, args, answer) => {
  const as = String(args.as ?? 't');
  const cands = lowHpBench(env, s, f.player, Number(args.max ?? 90)).map((b) => b.id);
  if (answer !== undefined) {
    f.vars[as] = [(answer as number[])[0] as number];
    return 'next';
  }
  if (cands.length <= 1) {
    f.vars[as] = cands;
    return 'next';
  }
  return ask(s, { player: f.player, kind: 'slots', prompt: "Switch in which of your opponent's Benched Pokémon?", min: 1, max: 1, values: cands }, 'slots');
});

/**
 * Eldegoss, Breezy Gift: "Put this Pokémon and all attached cards into your deck."
 * This Pokémon (it is the Active Pokémon, having just attacked) leaves play with its whole stack, Energy and Tools, and all
 * of those cards go into its owner's deck. It is not a Knock Out and the deck is not shuffled yet (the attack searches
 * first and shuffles after). Sets variable `args.as` (default `done`) to 1 when it moved.
 */
registerCustom('c21.selfIntoDeck', (env, s, f, args) => {
  const as = String(args.as ?? 'done');
  const t = resolveSlot(s, ec(f), 'self');
  const owner = t ? (allSlots(s.p[0]).includes(t) ? 0 : allSlots(s.p[1]).includes(t) ? 1 : null) : null;
  if (!t || owner === null) {
    f.vars[as] = 0;
    return 'next';
  }
  const ps = s.p[owner];
  if (ps.active === t) ps.active = null;
  else ps.bench = ps.bench.filter((b) => b !== t);
  s.effects = s.effects.filter((x) => x.slot !== t.id);
  if (s.delayed?.length) s.delayed = s.delayed.filter((d) => d.slot !== t.id);
  ps.deck.push(...slotCards(t));
  f.vars[as] = 1;
  return 'next';
});

/**
 * Lapras ex, Larimar Rain: "Look at the top 20 cards of your deck and attach any number of Energy cards you find there to
 * your Pokémon in any way you like." (the look-and-choose half). args: { n, filter, as } -- the controller picks any number
 * (0 to all) of the cards among the top n that match `filter` into variable `as`. Nothing moves yet: the program attaches
 * them (each to a Pokémon of the controller's choosing) and then shuffles the deck.
 */
registerCustom('c21.lookTopAny', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const as = String(args.as ?? 'e');
  const n = Number(args.n ?? 20);
  const filter = args.filter as Filter | undefined;
  const opts = ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse().filter((c) => cardMatches(env, c, filter)); // top first
  if (answer !== undefined) {
    f.vars[as] = (answer as number[]).filter((c) => opts.includes(c));
    return 'next';
  }
  if (!opts.length) {
    f.vars[as] = [];
    return 'next';
  }
  return ask(
    s,
    { player: f.player, kind: 'cards', prompt: 'Attach any number of these Energy cards to your Pokémon', min: 0, max: opts.length, values: opts },
    'cards',
  );
});
