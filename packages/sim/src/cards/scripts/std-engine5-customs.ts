/**
 * Bespoke effects for the "std-engine5" batch (std-engine5.ts). Names are prefixed `engine5.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-engine5.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter } from '../../dsl.js';
import { cardMatches } from '../../eval.js';
import { cardUnits } from '../../query.js';
import { allSlots, emit, findSlot } from '../../state.js';
import type { Decision, GameState, Slot, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/** Move an attached Energy card from one Pokémon to another (it stays attached to a Pokémon of the same player). */
function moveCard(env: Parameters<typeof emit>[0], card: number, from: Slot, to: Slot, player: number): void {
  from.energy = from.energy.filter((e) => e !== card);
  to.energy.push(card);
  emit(env, { type: 'attach', player: player as 0 | 1, card, slot: to.id });
}

/** The attached Energy cards of `sl` that match `filter` as they are on this Pokémon ("{M} Energy" is any card that provides {M} here). */
function energyOn(env: Parameters<typeof cardMatches>[0], sl: Slot, filter: Filter | undefined): number[] {
  const pt = filter?.providesType;
  const rest = pt ? { ...filter, providesType: undefined } : filter;
  return sl.energy.filter((c) => cardMatches(env, c, rest) && (!pt || cardUnits(env, sl, c).some((u) => u === pt || u === 'Any')));
}

/**
 * "Move any amount of [filter] Energy from your other / Benched Pokémon to this / your Active Pokémon." (Cobalion ex, Metal Road;
 * Latios, Lustrous Assist.) args: { from: 'others' | 'bench', to: 'self' | 'active', filter? }.
 *  - from 'others': every Pokémon of the controller except the one using the Ability; 'bench': their Benched Pokémon.
 *  - to 'self': the Pokémon using the Ability; 'active': the controller's Active Pokémon.
 * The controller picks 0 to all of the matching Energy cards (the choice names the Pokémon each is on); every card picked moves.
 * Nothing is asked when no Pokémon has any to move. The Energy stays on the controller's side, so no effect of an opponent is involved.
 */
registerCustom('engine5.moveAnyEnergy', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const me = findSlot(s, f.slot)?.slot;
  const dest = args.to === 'active' ? ps.active : me;
  if (!dest) return 'next';
  const filter = args.filter as Filter | undefined;
  const pool: { card: number; from: Slot }[] = [];
  const labels: string[] = [];
  for (const sl of args.from === 'bench' ? ps.bench : allSlots(ps)) {
    if (sl === dest || (args.from !== 'bench' && sl === me)) continue;
    for (const c of energyOn(env, sl, filter)) {
      pool.push({ card: c, from: sl });
      labels.push(`${def(env.ctx, c).name} on ${def(env.ctx, sl.cards[sl.cards.length - 1] as number).name}`);
    }
  }
  if (!pool.length) return 'next';
  if (answer === undefined) {
    return ask(s, { player: f.player, kind: 'cards', prompt: `Move any amount of Energy to ${def(env.ctx, dest.cards[dest.cards.length - 1] as number).name}`, min: 0, max: pool.length, values: pool.map((x) => x.card), labels }, 'cards');
  }
  for (const c of answer as number[]) {
    const p = pool.find((x) => x.card === c);
    if (p) moveCard(env, c, p.from, dest, f.player);
  }
  return 'next';
});

/**
 * "Move N Energy from this Pokémon to 1 of your Benched Pokémon." (Yanmega ex, Jet Cyclone.) args: { n, to } -- `to` is the variable
 * holding the Benched Pokémon chosen earlier. The controller picks which N Energy cards (all of them when this Pokémon has N or fewer).
 */
registerCustom('engine5.moveEnergyFromSelf', (env, s, f, args, answer) => {
  const me = findSlot(s, f.slot)?.slot;
  const v: Val | undefined = f.vars[String(args.to)];
  const toId = Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined;
  const dest = toId === undefined ? undefined : findSlot(s, toId)?.slot;
  if (!me || !dest || !me.energy.length) return 'next';
  const n = Number(args.n ?? 1);
  let chosen: number[];
  if (me.energy.length <= n) chosen = me.energy.slice();
  else if (answer !== undefined) chosen = answer as number[];
  else return ask(s, { player: f.player, kind: 'cards', prompt: `Move ${n} Energy to the Benched Pokémon`, min: n, max: n, values: me.energy.slice() }, 'cards');
  for (const c of chosen) moveCard(env, c, me, dest, f.player);
  return 'next';
});
