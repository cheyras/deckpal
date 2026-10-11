/**
 * Bespoke effects for the "std-c04" batch (std-c04.ts). Names are prefixed `c04.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c04.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def, type Env } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import { cardMatches, resolveSlot } from '../../eval.js';
import { cardUnits, effectsPrevented } from '../../query.js';
import { emit, findSlot, newSlot, opp, removeFrom, shuffleDeck, takeFromZones } from '../../state.js';
import type { Filter } from '../../dsl.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function allSame(env: Env, pool: number[]): boolean {
  return new Set(pool.map((c) => def(env.ctx, c).idx)).size <= 1;
}

/**
 * Salazzle, Sudden Scorching: "If this Pokémon evolved from Salandit during this turn, ..."
 * True when this Pokémon (the one whose attack or Ability this is) evolved this turn and the card it evolved from
 * (the one directly under its top card) is named `args.name`.
 */
registerCustomCond('c04.evolvedFromThisTurn', (env, s, ec, args) => {
  const sl = resolveSlot(s, ec, 'self');
  if (!sl || sl.evolvedTurn !== s.turn || sl.cards.length < 2) return false;
  return def(env.ctx, sl.cards[sl.cards.length - 2] as number).name === String(args.name);
});

/**
 * Silcoon, Multiplying Cocoon: "Search your deck for a Silcoon or a Cascoon and put it onto your Bench. Then, shuffle your deck."
 * args: { names } -- Pokémon cards of any Stage with one of these names. The Bench can only be filled to 5: with a
 * full Bench nothing happens (no search, no shuffle). The controller picks 0 or 1 of the matching cards, which go
 * onto the Bench as they are (a Stage 1 put there this way is not evolving anything); then the deck is shuffled.
 */
registerCustom('c04.searchToBench', (env, s, f, args, answer) => {
  const p = f.player;
  const ps = s.p[p];
  if (ps.bench.length >= 5) return 'next';
  const names = (args.names as string[]) ?? [];
  if (answer === undefined) {
    ps.prizesKnown = true;
    const opts = ps.deck.filter((c) => {
      const d = def(env.ctx, c);
      return d.kind === 'pokemon' && names.includes(d.name);
    });
    if (opts.length) {
      return ask(s, { player: p, kind: 'cards', prompt: `Put ${names.join(' or ')} onto your Bench`, min: 0, max: 1, values: opts }, 'cards');
    }
    emit(env, { type: 'search', player: p, found: [] });
    shuffleDeck(env, s, p);
    return 'next';
  }
  const c = (answer as number[])[0];
  emit(env, { type: 'search', player: p, found: c === undefined ? [] : [c] });
  if (c !== undefined && takeFromZones(ps, c)) {
    const sl = newSlot(s, c);
    ps.bench.push(sl);
    emit(env, { type: 'play_to_bench', player: p, card: c, slot: sl.id });
  }
  shuffleDeck(env, s, p);
  return 'next';
});

/**
 * Ethan's Magcargo, Lava Burst: "Discard up to 5 {R} Energy from this Pokémon. This attack does 70 damage for each card
 * you discarded in this way." (the choice half)
 * args: { n, filter, as } -- the controller picks 0 to n of the Energy cards attached to this Pokémon that provide the
 * filter's `providesType` (Basic or Special). Nothing is discarded yet: the picked cards land in variable `as` (default
 * `d`) for `seed4.discardPicked`, which the attack runs after its damage (the order Raging Bolt ex's identically worded
 * Bellowing Thunder uses, TPCi 2026-07-16 #2423).
 */
registerCustom('c04.pickEnergyOnSelf', (env, s, f, args, answer) => {
  const as = String(args.as ?? 'd');
  const loc = findSlot(s, f.slot);
  if (!loc) {
    f.vars[as] = [];
    return 'next';
  }
  const filter = (args.filter ?? {}) as Filter;
  const pt = filter.providesType;
  const rest = pt ? { ...filter, providesType: undefined } : filter;
  const pool = loc.slot.energy.filter((c) => cardMatches(env, c, rest) && (!pt || cardUnits(env, loc.slot, c).some((u) => u === pt || u === 'Any')));
  if (answer !== undefined) {
    f.vars[as] = (answer as number[]).filter((c) => pool.includes(c));
    return 'next';
  }
  if (!pool.length) {
    f.vars[as] = [];
    return 'next';
  }
  const n = Math.min(Number(args.n ?? 5), pool.length);
  return ask(s, { player: f.player, kind: 'cards', prompt: `Discard up to ${n} Energy from this Pokémon`, min: 0, max: n, values: pool.slice() }, 'cards');
});

/**
 * Dustox, Boisterous Wind: "put an Energy attached to your opponent's Active Pokémon into their hand."
 * The controller picks which Energy card (no question when the choices are identical); it goes to its owner's hand and
 * is not discarded. A Defending Pokémon protected from the effects of Abilities (or attacks, when an attack uses this)
 * keeps its Energy.
 */
registerCustom('c04.oppActiveEnergyToHand', (env, s, f, _args, answer) => {
  const o = opp(f.player);
  const t = s.p[o].active;
  if (!t || !t.energy.length) return 'next';
  if (effectsPrevented(env, s, t, f.player, f.kind === 'ability' ? 'ability' : 'attack')) return 'next';
  let card: number;
  if (answer !== undefined) card = (answer as number[])[0] as number;
  else if (allSame(env, t.energy)) card = t.energy[0] as number;
  else return ask(s, { player: f.player, kind: 'cards', prompt: "Put which of your opponent's Active Pokémon's Energy into their hand?", min: 1, max: 1, values: t.energy.slice() }, 'cards');
  if (!removeFrom(t.energy, card)) return 'next';
  s.p[o].hand.push(card);
  return 'next';
});
