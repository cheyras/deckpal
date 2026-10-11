/**
 * Bespoke effects for the "std-c01" batch (std-c01.ts). Names are prefixed `c01.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c01.test.ts.
 */
import { def } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import type { Filter } from '../../dsl.js';
import { cardMatches, evalCond, slotsIn } from '../../eval.js';
import { queueStadiumBench } from '../../interp.js';
import { maxHp, statics } from '../../query.js';
import { emit, findSlot, newSlot, removeFrom, takeFromZones } from '../../state.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

function idsOf(v: unknown): number[] {
  return Array.isArray(v) ? (v as number[]) : typeof v === 'number' ? [v] : [];
}

/**
 * Ninjask, Cast-Off Shell: "Search your deck for a Shedinja and put it onto your Bench."
 * Puts the cards in variable `args.cards` onto the controller's Bench whatever their Stage (the `move` step's 'bench'
 * only takes Basic Pokémon; Shedinja is a Stage 1 and does not become a Basic by being put there, Compendium #994),
 * as far as the Bench has room. Like any Pokémon put onto the Bench it counts as put into play this turn and sets off a
 * Stadium that watches for Pokémon put onto the Bench (Risky Ruins).
 */
registerCustom('c01.benchCards', (env, s, f, args) => {
  const ops = s.p[f.player];
  for (const c of idsOf(f.vars[String(args.cards ?? 'found')])) {
    if (def(env.ctx, c).kind !== 'pokemon' || ops.bench.length >= 5) continue;
    if (!takeFromZones(ops, c)) continue;
    const sl = newSlot(s, c);
    ops.bench.push(sl);
    emit(env, { type: 'play_to_bench', player: f.player, card: c, slot: sl.id });
    queueStadiumBench(env, s, sl, f.player);
  }
  return 'next';
});

/**
 * Ninetales, Supernatural Shapeshifter: "... if that card is a Supporter card, use the effect of that card as the
 * effect of this attack."
 * Runs the Supporter card in variable `args.card` as the controller's own effect: its play program is pushed as a
 * frame, the card stays where it is (it is not played, so it doesn't count as the turn's Supporter, Compendium #2225,
 * #2226) and its effect can't be declined (#2227). A Supporter whose own "can be played" condition fails does nothing.
 */
registerCustom('c01.useSupporterEffect', (env, s, f, args) => {
  const card = idsOf(f.vars[String(args.card ?? 'x')])[0];
  if (card === undefined) return 'next';
  const d = def(env.ctx, card);
  if (d.kind !== 'trainer' || d.ttype !== 'supporter' || !d.playCode) return 'next';
  if (d.playable && !evalCond(env, s, { player: f.player, slot: 0, vars: { __src: card } }, d.playable)) return 'next';
  f.pc++; // resume after this op when the Supporter's frame finishes
  s.stack.push({ code: d.playCode, pc: 0, vars: {}, player: f.player, src: card, slot: 0, kind: 'trainer' });
  return 'wait';
});

/**
 * Volcanion, Backfire: "Put 2 {R} Energy attached to this Pokémon into your hand."
 * args: { n, filter }. The controller picks `n` of this Pokémon's Energy cards that match `filter` (all of them when it
 * has no more than `n`; no question when the choices are identical) and they go to the controller's hand, not the discard pile.
 */
registerCustom('c01.energyToHandFiltered', (env, s, f, args, answer) => {
  const loc = findSlot(s, f.slot);
  if (!loc) return 'next';
  const n = Number(args.n ?? 1);
  const filter = args.filter as Filter | undefined;
  const pool = loc.slot.energy.filter((c) => cardMatches(env, c, filter));
  if (!pool.length) return 'next';
  let chosen: number[];
  if (answer !== undefined) chosen = (answer as number[]).filter((c) => pool.includes(c));
  else if (pool.length <= n) chosen = pool.slice();
  else if (new Set(pool.map((c) => def(env.ctx, c).idx)).size === 1) chosen = pool.slice(0, n);
  else return ask(s, { player: f.player, kind: 'cards', prompt: `Put ${n} Energy into your hand`, min: n, max: n, values: pool }, 'cards');
  for (const c of chosen) {
    if (removeFrom(loc.slot.energy, c)) s.p[loc.owner].hand.push(c);
  }
  return 'next';
});

/**
 * Inteleon, Bring Down: "Choose a Pokémon in play (yours or your opponent's) that has the least HP remaining, except
 * for this Pokémon, ..."
 * Stores the chosen Pokémon (a list of one slot id) in variable `args.as` (default `t`): the Pokémon, other than the
 * attacker, with the fewest HP remaining (HP minus damage) among both players' Pokémon. The controller picks among
 * Pokémon tied for the least. The attack's Knock Out step follows it.
 */
registerCustom('c01.leastHpRemaining', (env, s, f, args, answer) => {
  const as = String(args.as ?? 't');
  if (answer !== undefined) {
    f.vars[as] = [(answer as number[])[0] as number];
    return 'next';
  }
  const all = statics(env, s);
  const cands = slotsIn(s, f.player, 'allPokemon').filter((sl) => sl.id !== f.slot);
  if (!cands.length) {
    f.vars[as] = [];
    return 'next';
  }
  const left = (id: number): number => {
    const sl = cands.find((x) => x.id === id) as (typeof cands)[number];
    return maxHp(env, s, sl, all) - sl.damage;
  };
  const least = Math.min(...cands.map((sl) => left(sl.id)));
  const tied = cands.filter((sl) => left(sl.id) === least).map((sl) => sl.id);
  if (tied.length === 1) {
    f.vars[as] = tied;
    return 'next';
  }
  return ask(s, { player: f.player, kind: 'slots', prompt: 'Choose a Pokémon with the least HP remaining', min: 1, max: 1, values: tied }, 'slots');
});

/**
 * Magnezone, Upper Spark: "If this Pokémon evolved from Magneton during this turn, ..."
 * True when this Pokémon evolved this turn and the card it evolved from (the one under its top card) is named `args.from`.
 */
registerCustomCond('c01.evolvedFromThisTurn', (env, s, ec, args) => {
  const loc = ec.slot ? findSlot(s, ec.slot) : null;
  if (!loc || loc.slot.evolvedTurn !== s.turn || loc.slot.cards.length < 2) return false;
  return def(env.ctx, loc.slot.cards[loc.slot.cards.length - 2] as number).name === args.from;
});
