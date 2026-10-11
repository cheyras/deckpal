/**
 * Bespoke effects for the "std-c06" batch (std-c06.ts). Names are prefixed `c06.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c06.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def, type Env } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import type { Filter, SlotZone } from '../../dsl.js';
import { slotMatches, slotsIn } from '../../eval.js';
import { allSlots, emit, findSlot, takeFromZones } from '../../state.js';
import type { Decision, GameState, Slot, TimedEffect, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function cardsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}

/**
 * Fan Rotom, Fan Call: "Once during your first turn, you may ..." -- the controller's OWN first turn: turn 1 for the
 * player who went first, turn 2 for the other (the engine's `firstTurn` condition is only the first player's).
 */
registerCustomCond('c06.ownFirstTurn', (_env, s, ec) => s.turn === (ec.player === s.first ? 1 : 2));

/** The marker a Pokémon carries after using an attack: a timed effect that blocks no real attack (nothing is named this). */
function usedMarker(attack: string): string {
  return `\u0000used:${attack}`;
}

/**
 * Togedemaru ex, Spiky Rolling: "If this Pokémon used Spiky Rolling during your last turn, ..." (the remembering half)
 * Records that this Pokémon used the attack `args.attack`: a marker effect on the Pokémon that lasts through the end of
 * its controller's NEXT turn. It stays with the Pokémon if it moves to the Bench and back (it did use the attack),
 * and goes when the Pokémon leaves play.
 */
registerCustom('c06.rememberAttack', (_env, s, f, args) => {
  const e: TimedEffect = {
    static: { k: 'cantUseAttack', attack: usedMarker(String(args.attack)) },
    slot: f.slot,
    player: f.player,
    until: s.turn + 2,
    fromAttack: false,
    src: f.src,
  };
  s.effects = [...s.effects, e];
  return 'next';
});

/**
 * Togedemaru ex, Spiky Rolling: "If this Pokémon used Spiky Rolling during your last turn, ..." (the asking half)
 * True when this Pokémon carries the marker `c06.rememberAttack` left for `args.attack` during its controller's previous turn.
 */
registerCustomCond('c06.usedLastTurn', (_env, s, ec, args) => {
  const mark = usedMarker(String(args.attack));
  return s.effects.some((e) => e.slot === ec.slot && e.static.k === 'cantUseAttack' && e.static.attack === mark);
});

/**
 * Terapagos, Prism Charge: "Search your deck for up to 3 Basic Energy cards of different types ..." (the search half)
 * The controller picks up to `args.n` (default 3) Basic Energy cards from their deck, one at a time, each of a type no
 * earlier pick provides; choosing none stops. The picks land in variable `as` (default `found`). Nothing leaves the deck yet.
 */
registerCustom('c06.pickDifferentEnergy', (env, s, f, args, answer) => {
  const n = Number(args.n ?? 3);
  const as = String(args.as ?? 'found');
  const ps = s.p[f.player];
  ps.prizesKnown = true; // the player looked through their deck
  const picked = cardsOf(f.vars.__c06pick);
  let done = false;
  if (answer !== undefined) {
    const a = answer as number[];
    if (a.length) picked.push(a[0] as number);
    else done = true;
  }
  if (!done && picked.length < n) {
    const taken = new Set(picked.flatMap((c) => def(env.ctx, c).provides));
    const seen = new Set<number>();
    const opts: number[] = [];
    for (const c of ps.deck) {
      const d = def(env.ctx, c);
      if (d.kind !== 'energy' || !d.basicEnergy || d.provides.some((t) => taken.has(t)) || seen.has(d.idx)) continue;
      seen.add(d.idx);
      opts.push(c); // one card per distinct Energy: identical cards are one choice
    }
    if (opts.length) {
      f.vars.__c06pick = picked;
      return ask(s, { player: f.player, kind: 'cards', prompt: 'Search for a Basic Energy of a different type (or none to stop)', min: 0, max: 1, values: opts }, 'cards');
    }
  }
  delete f.vars.__c06pick;
  f.vars[as] = picked;
  emit(env, { type: 'search', player: f.player, found: picked.slice() });
  return 'next';
});

/**
 * Terapagos, Prism Charge: "... and attach them to your Tera Pokémon in any way you like."
 * Glass Trumpet: "... attach a Basic Energy card from your discard pile to each of them."
 * Attaches each card in variable `args.cards` (taken from wherever it is) to one of the controller's Pokémon, the
 * controller choosing the Pokémon for each card (no question when only one is possible):
 *  - the candidates are the Pokémon in variable `args.slots`, or else those in `args.zone` matching `args.filter`;
 *  - with `args.distinct`, a Pokémon takes at most one of the cards.
 * Cards left over when no Pokémon can take them stay where they were.
 */
registerCustom('c06.attachSplit', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const cards = cardsOf(f.vars[String(args.cards)]);
  const distinct = !!args.distinct;
  const pool = (): Slot[] => {
    if (args.slots) {
      return cardsOf(f.vars[String(args.slots)])
        .map((id) => findSlot(s, id))
        .filter((l): l is NonNullable<ReturnType<typeof findSlot>> => !!l && l.owner === f.player)
        .map((l) => l.slot);
    }
    return slotsIn(s, f.player, String(args.zone ?? 'myPokemon') as SlotZone).filter((sl) => slotMatches(env, sl, args.filter as Filter | undefined, true, s));
  };
  let i = (f.vars.__c06i as number | undefined) ?? 0;
  const used = cardsOf(f.vars.__c06used);
  const attach = (card: number, slot: Slot): void => {
    if (!takeFromZones(ps, card)) return;
    slot.energy.push(card);
    emit(env, { type: 'attach', player: f.player, card, slot: slot.id });
    used.push(slot.id);
  };
  if (answer !== undefined) {
    const target = allSlots(ps).find((sl) => sl.id === (answer as number[])[0]);
    if (target) attach(cards[i] as number, target);
    i++;
  }
  while (i < cards.length) {
    const cands = pool().filter((sl) => !distinct || !used.includes(sl.id));
    if (!cands.length) break;
    if (cands.length > 1) {
      f.vars.__c06i = i;
      f.vars.__c06used = used;
      return ask(
        s,
        { player: f.player, kind: 'slots', prompt: `Attach ${def(env.ctx, cards[i] as number).name} to which Pokémon?`, min: 1, max: 1, values: cands.map((sl) => sl.id) },
        'slots',
      );
    }
    attach(cards[i] as number, cands[0] as Slot);
    i++;
  }
  delete f.vars.__c06i;
  delete f.vars.__c06used;
  return 'next';
});
