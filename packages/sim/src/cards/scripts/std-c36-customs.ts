/**
 * Bespoke effects for the "std-c36" batch (std-c36.ts). Names are prefixed `c36.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c36.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { emit, topCard } from '../../state.js';
import type { Decision, GameState, Slot } from '../../types.js';

function ask(s: GameState, d: Decision): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode: 'cards' } };
  return 'wait';
}

/**
 * N's Plan: "Move up to 2 Energy from your Benched Pokémon to your Active Pokémon."
 * Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2205/): Energy cards that provide more than one Energy each
 * can be moved; the limit counts Energy cards.
 * args: { max } (default 2). The controller picks 1 to `max` of the Energy cards attached to their Benched Pokémon (the choice
 * names the Pokémon each is on); every card picked moves to their Active Pokémon. Nothing happens when no Benched Pokémon has
 * Energy or there is no Active Pokémon.
 */
registerCustom('c36.benchEnergyToActive', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const act = ps.active;
  if (!act) return 'next';
  const max = Number(args.max ?? 2);
  const pool: { card: number; from: Slot }[] = [];
  const labels: string[] = [];
  for (const sl of ps.bench) {
    for (const c of sl.energy) {
      pool.push({ card: c, from: sl });
      labels.push(`${def(env.ctx, c).name} on ${def(env.ctx, topCard(sl)).name}`);
    }
  }
  if (!pool.length) return 'next';
  if (answer === undefined) {
    return ask(s, { player: f.player, kind: 'cards', prompt: `Move up to ${max} Energy from your Benched Pokémon to your Active Pokémon`, min: 1, max: Math.min(max, pool.length), values: pool.map((x) => x.card), labels });
  }
  for (const c of (answer as number[]).slice(0, max)) {
    const p = pool.find((x) => x.card === c);
    if (!p) continue;
    p.from.energy = p.from.energy.filter((e) => e !== c);
    act.energy.push(c);
    emit(env, { type: 'attach', player: f.player, card: c, slot: act.id });
  }
  return 'next';
});
