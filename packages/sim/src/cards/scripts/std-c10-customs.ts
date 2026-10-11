/**
 * Bespoke effects for the "std-c10" batch (std-c10.ts). Names are prefixed `c10.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c10.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { evolveOnto } from '../../evolve.js';
import { def, type Env } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import { beginEvent, queueTriggers } from '../../interp.js';
import { weaknessOf } from '../../query.js';
import { emit, findSlot, opp, removeFrom, topCard } from '../../state.js';
import type { Decision, GameState, Player, Slot } from '../../types.js';

function ask(s: GameState, d: Decision): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode: 'cards' } };
  return 'wait';
}

/** Cards in the controller's hand that evolve from the Pokémon in this slot (by name). */
function evolutionsInHand(env: Env, s: GameState, p: Player, sl: Slot): number[] {
  const name = def(env.ctx, topCard(sl)).name;
  return s.p[p].hand.filter((c) => {
    const d = def(env.ctx, c);
    return d.kind === 'pokemon' && d.stage >= 1 && d.evolvesFrom === name;
  });
}

/**
 * Phantump, Spiteful Evolution (the gate): "Choose a card in your hand that evolves from this Pokémon ..."
 * True when the controller's hand holds a card that evolves from this Pokémon and it has not already evolved this turn.
 * (The "first turn" clause is a separate `c03.ownFirstTurn` check in the script.)
 */
registerCustomCond('c10.handEvolvesSelf', (env, s, ec) => {
  const sl = findSlot(s, ec.slot)?.slot;
  if (!sl || sl.evolvedTurn >= s.turn) return false;
  return evolutionsInHand(env, s, ec.player, sl).length > 0;
});

/**
 * Phantump, Spiteful Evolution: "Choose a card in your hand that evolves from this Pokémon and put it onto this Pokémon to
 * evolve it." The controller picks one such card from their hand (no question when they are all the same card) and it goes
 * onto this Pokémon exactly as evolving from the hand does: Special Conditions and the effects of attacks on the Pokémon end,
 * and "when you play this Pokémon from your hand to evolve it" triggers run. Sets variable `evolved` to 1 when it evolved,
 * else 0, so the program can place the damage counters "if you do". Unlike a normal evolution it may be done the turn the
 * Pokémon came into play (ruling 2349) but not to a Pokémon that already evolved this turn.
 */
registerCustom('c10.evolveSelfFromHand', (env, s, f, _args, answer) => {
  const p = f.player;
  const ps = s.p[p];
  f.vars.evolved = 0;
  const sl = findSlot(s, f.slot)?.slot;
  if (!sl || sl.evolvedTurn >= s.turn) return 'next';
  const opts = evolutionsInHand(env, s, p, sl);
  if (!opts.length) return 'next';
  let card: number;
  if (answer !== undefined) card = (answer as number[])[0] as number;
  else if (new Set(opts.map((c) => def(env.ctx, c).idx)).size === 1) card = opts[0] as number;
  else {
    return ask(s, { player: p, kind: 'cards', prompt: `Evolve ${def(env.ctx, topCard(sl)).name} with which card?`, min: 1, max: 1, values: opts });
  }
  if (!removeFrom(ps.hand, card)) return 'next';
  removeFrom(ps.revealed, card);
  evolveOnto(env, s, sl, card);
  emit(env, { type: 'evolve', player: p, card, slot: sl.id });
  beginEvent(s);
  queueTriggers(env, s, sl, p, 'evolveFromHand');
  f.vars.evolved = 1;
  return 'next';
});

/**
 * Adversity Policy: "If the Pokémon this card is attached to has Weakness to your opponent's Active Pokémon's type ..."
 * True when the Pokémon the Tool is attached to has a Weakness (as modified by effects) equal to one of the types of the
 * opponent's Active Pokémon. The trigger evaluates it as the damage lands, when that Active Pokémon is the attacker.
 */
registerCustomCond('c10.weakToOppActive', (env, s, ec) => {
  const holder = findSlot(s, ec.slot)?.slot;
  const attacker = s.p[opp(ec.player)].active;
  if (!holder || !attacker) return false;
  const w = weaknessOf(env, s, holder);
  return !!w && def(env.ctx, topCard(attacker)).types.includes(w);
});
