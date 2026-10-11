/**
 * Bespoke effects for the "std-c16" batch (std-c16.ts). Names are prefixed `c16.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c16.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import type { PType } from '../../dsl.js';
import { slotsIn } from '../../eval.js';
import { cardUnits, maxHp } from '../../query.js';
import { allSlots, emit, findSlot, removeFrom, topCard } from '../../state.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode: 'cards' } };
  return 'wait';
}

/**
 * Explorer's Guidance: "Look at the top 6 cards of your deck and put 2 of them into your hand. Discard the other cards."
 * args: { n, take }. The controller picks exactly `take` of the top `n` cards (all of them when there are no more than
 * `take`); those go to the hand, the other looked-at cards go to the discard pile. The deck is not shuffled.
 */
registerCustom('c16.lookTopTakeDiscardRest', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const n = Number(args.n ?? 6);
  const take = Number(args.take ?? 2);
  const top = ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse(); // top first
  if (!top.length) return 'next';
  let chosen: number[];
  if (answer !== undefined) chosen = (answer as number[]).filter((c) => top.includes(c)).slice(0, take);
  else if (top.length <= take) chosen = top.slice();
  else {
    return ask(s, {
      player: f.player,
      kind: 'cards',
      prompt: `Put ${take} of these into your hand (the rest are discarded)`,
      min: take,
      max: take,
      values: top,
    });
  }
  for (const c of top) removeFrom(ps.deck, c);
  ps.knownTop = Math.max(0, ps.knownTop - top.length);
  const rest = top.filter((c) => !chosen.includes(c));
  ps.hand.push(...chosen);
  ps.discard.push(...rest);
  if (rest.length) emit(env, { type: 'discard', player: f.player, cards: rest });
  return 'next';
});

/**
 * Sunflora, Redirected Sunlight: "60 damage for each {R} Energy attached to all of your opponent's Pokémon."
 * args: { type, as }. Sets variable `as` (default `n`) to the Energy provided as `type` by Energy attached to all of the
 * opponent's Pokémon, Active and Benched (Basic or Special; a card providing every type counts once).
 */
registerCustom('c16.energyOnOpp', (env, s, f, args) => {
  const type = String(args.type) as PType;
  let n = 0;
  for (const sl of slotsIn(s, f.player, 'oppPokemon')) {
    for (const c of sl.energy) n += cardUnits(env, sl, c).filter((u) => u === type || u === 'Any').length;
  }
  f.vars[String(args.as ?? 'n')] = n;
  return 'next';
});

/**
 * Sinistcha, Spill the Tea: "Discard up to 3 {G} Energy cards from your Pokémon."
 * args: { type, max, as }. The controller picks 0 to `max` Energy cards attached to their Pokémon that provide `type`
 * where they are attached (Basic or Special: "{G} Energy" is any Energy providing {G}, TPCi 2026-03-26); they go to the
 * discard pile and the number of cards discarded lands in `as` (default `n`).
 */
registerCustom('c16.discardEnergyAmong', (env, s, f, args, answer) => {
  const as = String(args.as ?? 'n');
  const type = String(args.type) as PType;
  const max = Number(args.max ?? 3);
  const ps = s.p[f.player];
  const pool: number[] = [];
  const labels: string[] = [];
  for (const sl of allSlots(ps)) {
    for (const c of sl.energy) {
      if (!cardUnits(env, sl, c).some((u) => u === type || u === 'Any')) continue;
      pool.push(c);
      labels.push(`${def(env.ctx, c).name} on ${def(env.ctx, topCard(sl)).name}`);
    }
  }
  if (!pool.length) {
    f.vars[as] = 0;
    return 'next';
  }
  if (answer === undefined) {
    return ask(s, { player: f.player, kind: 'cards', prompt: `Discard up to ${max} Energy cards`, min: 0, max: Math.min(max, pool.length), values: pool, labels });
  }
  const chosen = (answer as number[]).filter((c) => pool.includes(c)).slice(0, max);
  for (const c of chosen) {
    for (const sl of allSlots(ps)) if (removeFrom(sl.energy, c)) break;
    ps.discard.push(c);
  }
  if (chosen.length) emit(env, { type: 'discard', player: f.player, cards: chosen });
  f.vars[as] = chosen.length;
  return 'next';
});

/** True while c16.remainingHpAtMost is computing the Pokémon's HP (see below). */
let computingHp = false;

/**
 * Rescue Board: "If that Pokémon's remaining HP is 30 or less". args: { n }. True when the source Pokémon's HP (printed plus
 * any HP changes) minus its damage is at most n; for a Tool, the source is the Pokémon it is attached to.
 * Computing the HP gathers every live static, which evaluates this very condition again (the Tool's own 'when'); that inner
 * evaluation answers false. It only matters for the Retreat Cost effect it gates, which does not change any HP.
 */
registerCustomCond('c16.remainingHpAtMost', (env, s, ec, args) => {
  if (computingHp) return false;
  const loc = findSlot(s, ec.slot);
  if (!loc) return false;
  computingHp = true;
  try {
    return maxHp(env, s, loc.slot) - loc.slot.damage <= Number(args.n ?? 30);
  } finally {
    computingHp = false;
  }
});
