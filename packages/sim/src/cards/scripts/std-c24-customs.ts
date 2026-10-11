/**
 * Bespoke effects for the "std-c24" batch (std-c24.ts). Names are prefixed `c24.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c24.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def, type Env } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter } from '../../dsl.js';
import { cardMatches, slotsIn } from '../../eval.js';
import { effectsPrevented } from '../../query.js';
import { emit, findSlot, opp, removeFrom } from '../../state.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function allSame(env: Env, pool: number[]): boolean {
  return new Set(pool.map((c) => def(env.ctx, c).idx)).size <= 1;
}

/**
 * Castform Sunny Form, Sunny Assist: "Move all Energy from this Pokémon to 1 of your Benched Pokémon."
 * Kilowattrel, Storm Bolt: "Move all Energy from this Pokémon to your Benched Pokémon in any way you like."
 * args: { split } -- false: the controller picks one Benched Pokémon (no question with a single one) and every Energy card
 * attached to this Pokémon moves there; true: the controller picks the Benched Pokémon for each Energy card in turn.
 * The cards move (they are not discarded). With no Energy or no Benched Pokémon nothing happens.
 */
registerCustom('c24.moveAllEnergyToBench', (env, s, f, args, answer) => {
  const src = findSlot(s, f.slot);
  if (!src) return 'next';
  const bench = s.p[src.owner].bench;
  const split = !!args.split;
  const move = (card: number, to: number): void => {
    const dst = bench.find((b) => b.id === to);
    if (!dst || !removeFrom(src.slot.energy, card)) return;
    dst.energy.push(card);
    emit(env, { type: 'attach', player: src.owner, card, slot: dst.id });
  };
  if (!bench.length || !src.slot.energy.length) return 'next';
  if (!split) {
    let to: number | undefined;
    if (answer !== undefined) to = (answer as number[])[0];
    else if (bench.length === 1) to = (bench[0] as { id: number }).id;
    else return ask(s, { player: f.player, kind: 'slots', prompt: 'Move all Energy to which Benched Pokémon?', min: 1, max: 1, values: bench.map((b) => b.id) }, 'slots');
    for (const c of src.slot.energy.slice()) move(c, to as number);
    return 'next';
  }
  let pending = f.vars.__c24card as number | undefined;
  if (answer !== undefined && pending !== undefined) {
    move(pending, (answer as number[])[0] as number);
    delete f.vars.__c24card;
    pending = undefined;
  }
  while (src.slot.energy.length) {
    const card = src.slot.energy[0] as number;
    if (bench.length === 1) {
      move(card, (bench[0] as { id: number }).id);
      continue;
    }
    f.vars.__c24card = card;
    return ask(
      s,
      { player: f.player, kind: 'slots', prompt: `Move ${def(env.ctx, card).name} to which Benched Pokémon?`, min: 1, max: 1, values: bench.map((b) => b.id) },
      'slots',
    );
  }
  return 'next';
});

/**
 * Ceruledge, Cursed Edge: "Discard all Special Energy from all of your opponent's Pokémon."
 * Every Special Energy card (whatever its text does right now) attached to the opponent's Active and Benched Pokémon goes to its
 * owner's discard pile. A Pokémon protected from the effects of attacks keeps its Energy.
 */
registerCustom('c24.discardSpecialEnergyAllOpp', (env, s, f) => {
  const o = opp(f.player);
  const special: Filter = { cat: 'energy', basicEnergy: false };
  for (const t of slotsIn(s, f.player, 'oppPokemon')) {
    if (effectsPrevented(env, s, t, f.player, 'attack')) continue;
    const gone = t.energy.filter((c) => cardMatches(env, c, special));
    if (!gone.length) continue;
    for (const c of gone) removeFrom(t.energy, c);
    s.p[o].discard.push(...gone);
    emit(env, { type: 'discard', player: o, cards: gone });
  }
  return 'next';
});

/**
 * Paldean Tauros, Upthrusting Horns: "... put 2 Energy attached to your opponent's Active Stage 2 Pokémon into their hand."
 * args: { n }. The controller picks `n` of the Energy cards attached to the opponent's Active Pokémon (all of them when it has
 * no more than `n`; no question when the choices are identical) and they go to their owner's hand, not the discard pile. A
 * Defending Pokémon protected from the effects of attacks keeps its Energy.
 */
registerCustom('c24.oppActiveEnergyToHand', (env, s, f, args, answer) => {
  const o = opp(f.player);
  const t = s.p[o].active;
  if (!t || !t.energy.length) return 'next';
  if (effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
  const n = Number(args.n ?? 1);
  const pool = t.energy.slice();
  let chosen: number[];
  if (answer !== undefined) chosen = (answer as number[]).filter((c) => pool.includes(c));
  else if (pool.length <= n) chosen = pool;
  else if (allSame(env, pool)) chosen = pool.slice(0, n);
  else return ask(s, { player: f.player, kind: 'cards', prompt: `Put ${n} Energy attached to your opponent's Active Pokémon into their hand`, min: n, max: n, values: pool }, 'cards');
  for (const c of chosen) {
    if (removeFrom(t.energy, c)) s.p[o].hand.push(c);
  }
  return 'next';
});
