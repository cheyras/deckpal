/**
 * Bespoke effects for the "std-s01" batch (std-s01.ts). Names are prefixed `s01.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-s01.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import type { Filter } from '../../dsl.js';
import { defMatches } from '../../eval.js';
import { emit, findSlot } from '../../state.js';
import type { Decision, GameState, TimedEffect } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/** The marker a Pokémon carries after an attack's damage hit it in the Active Spot: a timed effect that blocks no real attack. */
const ACTIVE_HIT = '\u0000s01:hitWhileActive';

/**
 * Miraidon, Photon Cord: "If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack ..." (the remembering half)
 * Leaves a marker on this Pokémon, lasting to the end of the current turn, when an opponent's attack damages it in the Active
 * Spot. An attack that then moves it to the Bench (Cranidos, Push Down) does not undo that it was in the Active Spot when the
 * damage was done (TPCi Rules Team, https://compendium.pokegym.net/ruling/2400/).
 */
registerCustom('s01.markHitWhileActive', (_env, s, f) => {
  const e: TimedEffect = {
    static: { k: 'cantUseAttack', attack: ACTIVE_HIT },
    slot: f.slot,
    player: f.player,
    until: s.turn,
    fromAttack: false,
    src: f.src,
  };
  s.effects = [...s.effects, e];
  return 'next';
});

/** Miraidon, Photon Cord (the asking half): true when this Pokémon carries the marker `s01.markHitWhileActive` left this turn. */
registerCustomCond('s01.hitWhileActive', (_env, s, ec) => s.effects.some((e) => e.slot === ec.slot && e.static.k === 'cantUseAttack' && e.static.attack === ACTIVE_HIT));

/**
 * Miraidon, Photon Cord: "Move up to 2 Basic {L} Energy cards from this Pokémon to 1 of your Benched Pokémon."
 * args: { max, filter }. The controller picks 1 of their Benched Pokémon other than this one (moving means the Energy goes to a
 * different Pokémon, ruling 2400), then 1 to `max` of the Energy cards on this Pokémon that match `filter` (an Ability's "up to"
 * is at least 1, ruling 2399). Nothing happens with no matching Energy or no other Benched Pokémon; nothing is asked when
 * there is no choice.
 */
registerCustom('s01.moveEnergyToBenched', (env, s, f, args, answer) => {
  const loc = findSlot(s, f.slot);
  if (!loc) return 'next';
  const filter = args.filter as Filter | undefined;
  const max = Number(args.max ?? 1);
  const pool = loc.slot.energy.filter((c) => defMatches(def(env.ctx, c), filter));
  const dests = s.p[loc.owner].bench.filter((b) => b.id !== loc.slot.id);
  const finish = (): 'next' => {
    delete f.vars.__s01to;
    return 'next';
  };
  if (!pool.length || !dests.length) return finish();
  let to = f.vars.__s01to as number | undefined;
  if (to === undefined) {
    if (answer !== undefined) {
      to = (answer as number[])[0];
      answer = undefined;
    } else if (dests.length === 1) to = dests[0]!.id;
    else {
      return ask(s, { player: f.player, kind: 'slots', prompt: 'Move the Energy to which Benched Pokémon?', min: 1, max: 1, values: dests.map((d) => d.id) }, 'slots');
    }
    f.vars.__s01to = to as number;
  }
  let picks: number[];
  if (answer !== undefined) picks = answer as number[];
  else if (pool.length <= 1) picks = pool.slice();
  else {
    return ask(s, { player: f.player, kind: 'cards', prompt: `Move up to ${max} Energy`, min: 1, max: Math.min(max, pool.length), values: pool }, 'cards');
  }
  const dst = dests.find((d) => d.id === to);
  if (dst) {
    for (const c of picks.slice(0, max)) {
      const i = loc.slot.energy.indexOf(c);
      if (i < 0) continue;
      loc.slot.energy.splice(i, 1);
      dst.energy.push(c);
      emit(env, { type: 'attach', player: loc.owner, card: c, slot: dst.id });
    }
  }
  return finish();
});
