/**
 * Bespoke effects for the "std-c07" batch (std-c07.ts). Names are prefixed `c07.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c07.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def, type Env } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import type { Filter, PType } from '../../dsl.js';
import { cardMatches } from '../../eval.js';
import { cardUnits } from '../../query.js';
import { emit } from '../../state.js';
import type { Decision, GameState, Slot } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
/** True when every card in the pool is the same card (identical cards need no question). */
function allSame(env: Env, pool: number[]): boolean {
  return new Set(pool.map((c) => def(env.ctx, c).idx)).size <= 1;
}
/** Does this attached Energy card provide `type` on this Pokémon (Basic or Special; "every type" counts)? */
function providesHere(env: Env, slot: Slot, card: number, type: PType): boolean {
  return cardUnits(env, slot, card).some((u) => u === type || u === 'Any');
}

/**
 * Waitress: "Look at the top 6 cards of your deck and attach a Basic Energy card you find there to 1 of your Pokémon."
 * (the look-and-choose half). args: { n, filter, as } -- looks at the top n cards of the deck and has the controller pick
 * exactly one card matching `filter` among them (none when none match) into variable `as`. Nothing moves yet: the program
 * attaches the card with an ordinary `attach` and then shuffles the deck.
 */
registerCustom('c07.lookTopPick', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const as = String(args.as ?? 'e');
  const n = Number(args.n ?? 6);
  const filter = args.filter as Filter | undefined;
  const top = ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse(); // top first
  const opts = top.filter((c) => cardMatches(env, c, filter));
  if (answer !== undefined) {
    f.vars[as] = (answer as number[]).filter((c) => opts.includes(c));
    return 'next';
  }
  if (!opts.length) {
    f.vars[as] = [];
    return 'next';
  }
  if (opts.length === 1 || allSame(env, opts)) {
    f.vars[as] = [opts[0] as number];
    return 'next';
  }
  return ask(s, { player: f.player, kind: 'cards', prompt: 'Attach which of these cards?', min: 1, max: 1, values: opts }, 'cards');
});

/** Does one of the controller's Benched Pokémon have an attached Energy card providing {type}? (Dewgong, Wash Out.) */
registerCustomCond('c07.benchHasEnergyOfType', (env, s, ec, args) => {
  const type = args.type as PType;
  return s.p[ec.player].bench.some((b) => b.energy.some((c) => providesHere(env, b, c, type)));
});

/**
 * Dewgong, Wash Out: "Move a {W} Energy from 1 of your Benched Pokémon to your Active Pokémon."
 * args: { type }. The controller picks a Benched Pokémon that has an Energy card providing {type} where it is attached
 * (Basic or Special; Prism Energy on a Basic Pokémon provides every type), then which such card when they differ; that card
 * moves to the Active Pokémon. Nothing happens when there is none.
 */
registerCustom('c07.moveEnergyToActive', (env, s, f, args, answer) => {
  const type = args.type as PType;
  const ps = s.p[f.player];
  const act = ps.active;
  if (!act) return 'next';
  const V = f.vars as Record<string, unknown>;
  if (V.__c07from === undefined) {
    const cands = ps.bench.filter((b) => b.energy.some((c) => providesHere(env, b, c, type)));
    if (!cands.length) return 'next';
    if (answer !== undefined) V.__c07from = (answer as number[])[0];
    else if (cands.length === 1) V.__c07from = (cands[0] as Slot).id;
    else {
      return ask(s, { player: f.player, kind: 'slots', prompt: 'Move an Energy from which Benched Pokémon?', min: 1, max: 1, values: cands.map((c) => c.id) }, 'slots');
    }
    answer = undefined;
  }
  const src = ps.bench.find((b) => b.id === V.__c07from);
  if (!src) {
    delete V.__c07from;
    return 'next';
  }
  const pool = src.energy.filter((c) => providesHere(env, src, c, type));
  let card: number | undefined;
  if (answer !== undefined) card = (answer as number[])[0];
  else if (pool.length === 1 || allSame(env, pool)) card = pool[0];
  else {
    return ask(s, { player: f.player, kind: 'cards', prompt: 'Move which Energy?', min: 1, max: 1, values: pool }, 'cards');
  }
  delete V.__c07from;
  const i = card === undefined ? -1 : src.energy.indexOf(card);
  if (card === undefined || i < 0) return 'next';
  src.energy.splice(i, 1);
  act.energy.push(card);
  emit(env, { type: 'attach', player: f.player, card, slot: act.id });
  return 'next';
});
