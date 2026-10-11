/**
 * Bespoke effects for the "std-s02" batch (std-s02.ts). Names are prefixed `s02.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-s02.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { evolveOnto } from '../../evolve.js';
import { def, type Env } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import { cardMatches } from '../../eval.js';
import { retreatCost } from '../../query.js';
import { allSlots, emit, findSlot, removeFrom, topCard } from '../../state.js';
import type { Decision, GameState, Player, Slot, TimedEffect } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/**
 * Zamazenta, Strong Bash: "... put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon."
 * Runs inside the `react` program (variable `__def` is the Pokémon that was damaged). Sets variable `as` (default `n`) to the
 * number of damage counters equal to the damage the opponent's attack did to it this turn: the engine keeps a running total of
 * attack damage per Pokémon per turn, counted before any cap at its HP (damage done can be more than its HP: TPCi Rules Team
 * 2165). 0 when none is on record.
 */
registerCustom('s02.damageDoneAsCounters', (_env, s, f, args) => {
  const t = findSlot(s, Number(f.vars.__def))?.slot;
  f.vars[String(args.as ?? 'n')] = t && t.attackDmgTurn === s.turn ? Math.floor((t.attackDmg ?? 0) / 10) : 0;
  return 'next';
});

/**
 * Heavy Baton: "If the Pokémon this card is attached to has a Retreat Cost of exactly 4, ..." (the asking half)
 * True when the Retreat Cost of the Pokémon this is attached to (or that has this Ability), with every effect that changes it,
 * is exactly `args.n`.
 */
registerCustomCond('s02.retreatCostIs', (env, s, ec, args) => {
  const loc = findSlot(s, ec.slot);
  return !!loc && def(env.ctx, topCard(loc.slot)).kind === 'pokemon' && retreatCost(env, s, loc.slot) === Number(args.n);
});

/**
 * Heavy Baton: "... move up to 3 Basic Energy cards from that Pokémon to your Benched Pokémon in any way you like."
 * args: { max } (default 3). The Pokémon is the one this Tool is attached to (the frame's slot), which may itself be on the Bench
 * by now (it was pushed there by the attack that Knocked it Out, TPCi ruling 1992): the Energy goes to a DIFFERENT Benched
 * Pokémon, never to itself. The controller picks 1 to `max` of its Basic Energy cards (a Tool's "up to" is at least 1: TPCi
 * 2026-07-16 ruling 2399), then the Benched Pokémon for each card in turn. Nothing is asked when there is no choice, and
 * nothing happens with no Basic Energy or no other Benched Pokémon.
 */
registerCustom('s02.moveBasicEnergyToBench', (env, s, f, args, answer) => {
  const loc = findSlot(s, f.slot);
  const max = Number(args.max ?? 3);
  const finish = (): 'next' => {
    delete f.vars.__s02picks;
    delete f.vars.__s02i;
    return 'next';
  };
  if (!loc) return finish();
  const src = loc.slot;
  const dests = s.p[loc.owner].bench.filter((b) => b.id !== src.id);
  let picks = f.vars.__s02picks as number[] | undefined;
  if (!picks) {
    const pool = src.energy.filter((c) => cardMatches(env, c, { basicEnergy: true }));
    if (!pool.length || !dests.length) return finish();
    if (answer !== undefined) {
      picks = (answer as number[]).filter((c) => pool.includes(c)).slice(0, max);
      answer = undefined;
    } else if (pool.length === 1) picks = pool.slice();
    else {
      return ask(s, { player: f.player, kind: 'cards', prompt: `Move up to ${max} Basic Energy cards to your Benched Pokémon`, min: 1, max: Math.min(max, pool.length), values: pool }, 'cards');
    }
    f.vars.__s02picks = picks;
    f.vars.__s02i = 0;
  }
  let i = f.vars.__s02i as number;
  while (i < picks.length) {
    const card = picks[i] as number;
    let to: Slot | undefined;
    if (answer !== undefined) {
      to = dests.find((d) => d.id === (answer as number[])[0]);
      answer = undefined;
    } else if (dests.length === 1) to = dests[0];
    else {
      f.vars.__s02i = i;
      return ask(s, { player: f.player, kind: 'slots', prompt: `Move ${def(env.ctx, card).name} to which Benched Pokémon?`, min: 1, max: 1, values: dests.map((d) => d.id) }, 'slots');
    }
    if (to && removeFrom(src.energy, card)) {
      to.energy.push(card);
      emit(env, { type: 'attach', player: loc.owner, card, slot: to.id });
    }
    i++;
  }
  return finish();
});

/** The marker a Miraidon carries after using C.O.D.E.: Protect: a timed effect that blocks no real attack. */
const CODE_PROTECT = '\u0000s02:codeProtect';

/**
 * Miraidon, C.O.D.E.: Protect: "During your opponent's next turn, prevent all damage done to each of your Future Pokémon by attacks
 * from Pokémon ex. If this Pokémon is no longer your Active Pokémon, this effect ends." (the remembering half)
 * Leaves a marker on this Pokémon that lasts through your opponent's next turn. Like every lasting effect of an attack on a
 * Pokémon, it ends when the Pokémon leaves the Active Spot (or is Knocked Out or evolves); the protection printed on the card
 * holds only while the marker does.
 */
registerCustom('s02.rememberCodeProtect', (_env, s, f) => {
  const e: TimedEffect = {
    static: { k: 'cantUseAttack', attack: CODE_PROTECT },
    slot: f.slot,
    player: f.player,
    until: s.turn + 1,
    fromAttack: true,
    src: f.src,
  };
  s.effects = [...s.effects, e];
  return 'next';
});

/** Miraidon, C.O.D.E.: Protect (the asking half): true during the turn after this Pokémon used it, while it carries the marker. */
registerCustomCond('s02.codeProtectActive', (_env, s, ec) =>
  s.effects.some((e) => e.slot === ec.slot && e.static.k === 'cantUseAttack' && e.static.attack === CODE_PROTECT && e.until === s.turn),
);

/**
 * Salvatore: "Search your deck for a card that has no Abilities and evolves from 1 of your Pokémon, and put it onto that Pokémon to
 * evolve it. ... You can use this card on a Pokémon you put down when you were setting up to play or on a Pokémon that was put into
 * play this turn."
 * The controller picks the card (up to 1: a search may find nothing), then, when 2 or more of their Pokémon could take it, which
 * Pokémon. A Pokémon that already evolved this turn can't evolve again; being new does not matter. The Evolution comes from the deck,
 * not the hand, so nothing that triggers "when you play this from your hand to evolve" fires. Evolving clears Special Conditions and
 * attack effects, as every Evolution does. The script shuffles afterwards.
 */
function salvatoreTargets(env: Env, s: GameState, p: Player, card: number): Slot[] {
  const d = def(env.ctx, card);
  return allSlots(s.p[p]).filter((sl) => sl.evolvedTurn < s.turn && !!d.evolvesFrom && def(env.ctx, topCard(sl)).name === d.evolvesFrom);
}
registerCustom('s02.salvatoreEvolve', (env, s, f, _args, answer) => {
  const p = f.player;
  let card = f.vars.__salCard as number | undefined;
  if (card === undefined) {
    const pool = s.p[p].deck.filter((c) => {
      const d = def(env.ctx, c);
      return d.kind === 'pokemon' && d.abilities.length === 0 && salvatoreTargets(env, s, p, c).length > 0;
    });
    if (!pool.length) return 'next';
    if (answer === undefined) {
      return ask(s, { player: p, kind: 'cards', prompt: 'Search your deck for a card with no Abilities that evolves from 1 of your Pokémon', min: 0, max: 1, values: pool }, 'cards');
    }
    card = (answer as number[]).find((c) => pool.includes(c));
    answer = undefined;
    if (card === undefined) return 'next';
    f.vars.__salCard = card;
  }
  const targets = salvatoreTargets(env, s, p, card);
  let sl: Slot | undefined;
  if (answer !== undefined) sl = targets.find((t) => t.id === (answer as number[])[0]);
  else if (targets.length === 1) sl = targets[0];
  else if (targets.length > 1) {
    return ask(s, { player: p, kind: 'slots', prompt: `Evolve which Pokémon into ${def(env.ctx, card).name}?`, min: 1, max: 1, values: targets.map((t) => t.id) }, 'slots');
  }
  delete f.vars.__salCard;
  if (!sl || !removeFrom(s.p[p].deck, card)) return 'next';
  evolveOnto(env, s, sl, card);
  emit(env, { type: 'evolve', player: p, card, slot: sl.id });
  return 'next';
});
