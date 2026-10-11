/**
 * Bespoke effects for the "std-c35" batch (std-c35.ts). Names are prefixed `c35.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c35.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { effectsPrevented, statics } from '../../query.js';
import { allSlots, emit, findSlot, opp, removeFrom, topCard } from '../../state.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots' | 'index'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/**
 * Elgyem, Slight Shift: "Move an Energy from 1 of your opponent's Pokémon to another of their Pokémon."
 * Mandatory. The controller picks one Energy card attached to an opposing Pokémon (the choice names the Pokémon it is on), then
 * the other opposing Pokémon it moves to (no question when only one qualifies). A Pokémon protected from the effects of attacks
 * (Mist Energy, Hide 'n' Sneak) can neither give nor receive the Energy (Compendium #2375: a Mist Energy on the Defending Pokémon
 * can't be moved to another Pokémon). Nothing happens when there is no such pair.
 */
registerCustom('c35.moveOppEnergy', (env, s, f, _args, answer) => {
  const os = s.p[opp(f.player)];
  const all = statics(env, s);
  const open = allSlots(os).filter((sl) => !effectsPrevented(env, s, sl, f.player, 'attack', all));
  const done = (): 'next' => {
    delete f.vars.__c35card;
    return 'next';
  };
  const picked = f.vars.__c35card as number | undefined;
  if (picked === undefined) {
    if (open.length < 2) return 'next';
    const pool: number[] = [];
    const where: string[] = [];
    for (const sl of open) {
      for (const c of sl.energy) {
        pool.push(c);
        where.push(`${def(env.ctx, c).name} on ${def(env.ctx, topCard(sl)).name}`);
      }
    }
    if (!pool.length) return 'next';
    if (answer === undefined) {
      return ask(s, { player: f.player, kind: 'cards', prompt: "Move which of your opponent's Energy?", min: 1, max: 1, values: pool, labels: where }, 'cards');
    }
    f.vars.__c35card = (answer as number[])[0] as number;
    answer = undefined;
  }
  const card = f.vars.__c35card as number;
  const from = open.find((sl) => sl.energy.includes(card));
  if (!from) return done();
  const targets = open.filter((sl) => sl.id !== from.id);
  if (!targets.length) return done();
  let to = targets.length === 1 ? targets[0] : undefined;
  if (!to && answer !== undefined) to = findSlot(s, (answer as number[])[0] ?? -1)?.slot;
  if (!to) {
    return ask(s, { player: f.player, kind: 'slots', prompt: 'Move it to which Pokémon?', min: 1, max: 1, values: targets.map((sl) => sl.id) }, 'slots');
  }
  if (removeFrom(from.energy, card)) {
    to.energy.push(card);
    emit(env, { type: 'attach', player: opp(f.player), card, slot: to.id });
  }
  return done();
});
