/**
 * Bespoke effects for the "std-c13" batch (std-c13.ts). Names are prefixed `c13.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c13.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { effectsPrevented } from '../../query.js';
import { emit, findSlot, opp, shuffleDeck, slotCards, topCard } from '../../state.js';
import type { Decision, GameState, Slot, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function idsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}

/**
 * Shiftry, Expelling Tornado: "Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's
 * Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."
 * args: { keep } -- the variable holding the Benched Pokémon chosen (by an earlier `chooseSlots`). Every other Benched
 * Pokémon of the opponent goes into their deck with everything attached, and the deck is shuffled once. A Pokémon
 * that is protected from the effects of attacks (Rabsca, Spherical Shield) stays where it is: it is still having the
 * attack's effect done to it even though it wasn't the one chosen (Ruling 1954).
 */
registerCustom('c13.shuffleBenchExcept', (env, s, f, args) => {
  const keep = idsOf(f.vars[String(args.keep ?? 'k')]);
  const o = opp(f.player);
  const ps = s.p[o];
  let moved = false;
  for (const sl of ps.bench.slice()) {
    if (keep.includes(sl.id)) continue;
    if (effectsPrevented(env, s, sl, f.player, 'attack')) continue;
    ps.bench = ps.bench.filter((b) => b !== sl);
    s.effects = s.effects.filter((x) => x.slot !== sl.id);
    ps.deck.push(...slotCards(sl));
    moved = true;
  }
  if (moved) shuffleDeck(env, s, o);
  return 'next';
});

/**
 * Iron Leaves ex, Rapid Vernier: "you may move any amount of Energy from your other Pokémon to this Pokémon."
 * The controller picks 0 to all of the Energy cards attached to their other Pokémon (the choice names the Pokémon each
 * is on); every card picked moves to the Pokémon using the Ability. Nothing is asked when no other Pokémon has Energy.
 */
registerCustom('c13.moveAnyEnergyToSelf', (env, s, f, _args, answer) => {
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
  if (answer === undefined) {
    return ask(s, { player: f.player, kind: 'cards', prompt: 'Move any amount of Energy to this Pokémon', min: 0, max: pool.length, values: pool.map((x) => x.card), labels }, 'cards');
  }
  for (const c of answer as number[]) {
    const p = pool.find((x) => x.card === c);
    if (!p) continue;
    p.from.energy = p.from.energy.filter((e) => e !== c);
    me.energy.push(c);
    emit(env, { type: 'attach', player: f.player, card: c, slot: me.id });
  }
  return 'next';
});

/**
 * Gouging Fire ex, Blaze Blitz: "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot."
 * args: { attack }. Puts an attack effect on this Pokémon that never runs out by turn: like every attack effect it ends
 * when the Pokémon leaves the Active Spot (or evolves, or is Knocked Out), and not before.
 */
registerCustom('c13.lockAttackUntilLeavesActive', (_env, s, f, args) => {
  const loc = findSlot(s, f.slot);
  if (!loc) return 'next';
  s.effects.push({
    static: { k: 'cantUseAttack', attack: String(args.attack) },
    slot: loc.slot.id,
    player: loc.owner,
    until: Number.MAX_SAFE_INTEGER,
    fromAttack: true,
    src: f.src,
  });
  return 'next';
});
