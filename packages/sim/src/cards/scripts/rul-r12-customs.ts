/**
 * Bespoke effects for the rulings audit, lane 12. Names are prefixed `rul12.`. Each is exercised by a test in
 * src/__tests__/rulings-r12.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { registerCustom } from '../../customs.js';
import { countersFixed, countersPrevented, effectsPrevented, ownerOf, statics } from '../../query.js';
import { emit, findSlot } from '../../state.js';
import type { Decision, Frame, GameState, Slot, Val } from '../../types.js';

function cardsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}

function slotVar(s: GameState, f: Frame, name: string): Slot | null {
  const id = cardsOf(f.vars[name])[0];
  return id === undefined ? null : (findSlot(s, id)?.slot ?? null);
}

function ask(s: GameState, d: Decision): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode: 'index' } };
  return 'wait';
}

/**
 * Munkidori, Adrena-Brain: "move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon."
 * Same as ghost.ts's `moveCounters`, except for Battle Cage: when the counters cannot be placed on the target (a Benched
 * Pokémon under Battle Cage) they are still taken off the source and simply vanish (Compendium #2257). A target that is
 * protected from the effects of Abilities (Hide 'n' Sneak) or a counters lock (Watchful Eye) still stops the whole move.
 */
registerCustom('rul12.moveCountersLossy', (env, s, f, args, answer) => {
  const from = slotVar(s, f, String(args.from));
  const to = slotVar(s, f, String(args.to));
  if (!from || !to || from === to) return 'next';
  const all = statics(env, s);
  if (countersFixed(env, s, ownerOf(s, from), all) || countersFixed(env, s, ownerOf(s, to), all)) return 'next';
  if ((f.kind === 'ability' || f.kind === 'attack') && effectsPrevented(env, s, to, f.player, f.kind, all)) return 'next';
  const vanish = (f.kind === 'ability' || f.kind === 'attack') && countersPrevented(env, s, to, f.player, f.kind, all);
  const n = Math.min(Number(args.max ?? 3), Math.floor(from.damage / 10));
  if (n <= 0) return 'next';
  let k: number;
  if (answer !== undefined) k = ((answer as number[])[0] ?? 0) + 1;
  else if (n === 1) k = 1;
  else {
    const labels = Array.from({ length: n }, (_, i) => `Move ${i + 1} damage counter${i ? 's' : ''}`);
    return ask(s, { player: f.player, kind: 'option', prompt: 'Move how many damage counters?', min: 1, max: 1, labels });
  }
  from.damage -= k * 10;
  if (vanish) return 'next';
  to.damage += k * 10;
  emit(env, { type: 'counters', player: ownerOf(s, to), slot: to.id, n: k });
  return 'next';
});
