/**
 * Bespoke effects for the "std-c05" batch (std-c05.ts). Names are prefixed `c05.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c05.test.ts.
 */
import { def, type Env } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { emit, findSlot, removeFrom, topCard } from '../../state.js';
import type { Decision, GameState, Slot } from '../../types.js';

function ask(s: GameState, d: Decision): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode: 'cards' } };
  return 'wait';
}

/** The Energy cards attached to the controller's Benched Pokémon, with a label naming the Pokémon each is on. */
function benchEnergy(s: GameState, player: 0 | 1, env: Env) {
  const cards: number[] = [];
  const labels: string[] = [];
  for (const sl of s.p[player].bench) {
    for (const c of sl.energy) {
      cards.push(c);
      labels.push(`${def(env.ctx, c).name} on ${def(env.ctx, topCard(sl)).name}`);
    }
  }
  return { cards, labels };
}

/**
 * Team Rocket's Mewtwo ex, Erasure Ball: "You may discard up to 2 Energy from your Benched Pokémon."
 * args: { max, as }. The controller picks 0 to `max` Energy CARDS attached to their Benched Pokémon; they go to the
 * discard pile and the number of cards discarded lands in `as` (Ruling 2340: the bonus counts cards, not Energy units).
 */
registerCustom('c05.discardBenchEnergy', (env, s, f, args, answer) => {
  const as = String(args.as ?? 'n');
  const max = Number(args.max ?? 2);
  const { cards, labels } = benchEnergy(s, f.player, env);
  if (!cards.length) {
    f.vars[as] = 0;
    return 'next';
  }
  if (answer === undefined) {
    return ask(s, {
      player: f.player,
      kind: 'cards',
      prompt: `Discard up to ${max} Energy from your Benched Pokémon`,
      min: 0,
      max: Math.min(max, cards.length),
      values: cards,
      labels,
    });
  }
  const chosen = (answer as number[]).filter((c) => cards.includes(c)).slice(0, max);
  for (const c of chosen) {
    for (const sl of s.p[f.player].bench) if (removeFrom(sl.energy, c)) break;
    s.p[f.player].discard.push(c);
  }
  if (chosen.length) emit(env, { type: 'discard', player: f.player, cards: chosen });
  f.vars[as] = chosen.length;
  return 'next';
});

/**
 * Azumarill ex, Bubble Gathering: "Move an Energy from 1 of your other Pokémon to this Pokémon."
 * The controller picks one Energy attached to any of their other Pokémon (the choice names the Pokémon each is on;
 * asked only when there is more than one); it moves to the Pokémon using the Ability. Nothing happens if no other
 * Pokémon has Energy.
 */
registerCustom('c05.moveEnergyToSelf', (env, s, f, _args, answer) => {
  const ps = s.p[f.player];
  const me = findSlot(s, f.slot)?.slot;
  if (!me) return 'next';
  const pool: { card: number; from: Slot }[] = [];
  const labels: string[] = [];
  for (const sl of [ps.active, ...ps.bench]) {
    if (!sl || sl === me) continue;
    for (const c of sl.energy) {
      pool.push({ card: c, from: sl });
      labels.push(`${def(env.ctx, c).name} on ${def(env.ctx, topCard(sl)).name}`);
    }
  }
  if (!pool.length) return 'next';
  let pick: { card: number; from: Slot } | undefined;
  if (answer !== undefined) pick = pool.find((x) => x.card === (answer as number[])[0]);
  else if (pool.length === 1) pick = pool[0];
  else {
    return ask(s, { player: f.player, kind: 'cards', prompt: 'Move which Energy to this Pokémon?', min: 1, max: 1, values: pool.map((x) => x.card), labels });
  }
  if (!pick) return 'next';
  removeFrom(pick.from.energy, pick.card);
  me.energy.push(pick.card);
  emit(env, { type: 'attach', player: f.player, card: pick.card, slot: me.id });
  return 'next';
});
