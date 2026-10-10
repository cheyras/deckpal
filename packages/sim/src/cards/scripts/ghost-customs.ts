/**
 * Custom effects for lane "ghost" (ghost.ts). Each is a named function the
 * scripts call with `{ op: 'custom', fn, args }` or `{ custom: name }` in a Cond,
 * and each has a card test in src/__tests__/cards-ghost.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (answer lands in `__a`) and
 * returns 'wait'; the interpreter re-runs it with the answer.
 */
import { def, type Env, type GameContext } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import { queueTriggers } from '../../interp.js';
import { countersFixed, effectsPrevented, ownerOf, statics } from '../../query.js';
import { allSlots, emit, findSlot, opp, removeFrom, slotCards, topCard } from '../../state.js';
import type { CardDef, Decision, Frame, GameState, Player, Slot, Val } from '../../types.js';
import { normText } from '../frame.js';
import { FRAMES } from '../frames-all.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function cardsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}

function slotVar(s: GameState, f: Frame, name: string): Slot | null {
  const id = cardsOf(f.vars[name])[0];
  return id === undefined ? null : (findSlot(s, id)?.slot ?? null);
}

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots' | 'index'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

function reveal(f: Frame, cards: number[]): void {
  if (cards.length) f.vars.__revealed = [...cardsOf(f.vars.__revealed), ...cards];
}

/** Distinct card definitions among these cards (identical cards are one choice). */
function distinctDefs(env: Env, cards: number[]): number {
  return new Set(cards.map((c) => def(env.ctx, c).idx)).size;
}

/** The player's own first turn (the second player's first turn is turn 2). */
function ownFirstTurn(s: GameState, p: Player): boolean {
  return s.turn === (p === s.first ? 1 : 2);
}

// ---------------------------------------------------------------------------
// Munkidori, Adrena-Brain: move damage counters (respects Watchful Eye)
// ---------------------------------------------------------------------------

/** Damage counters can be moved right now (no Watchful Eye-style lock on either side). */
registerCustomCond('countersMovable', (env, s, ec) => {
  const all = statics(env, s);
  return !countersFixed(env, s, ec.player, all) && !countersFixed(env, s, opp(ec.player), all);
});

/** Move up to `max` damage counters from the Pokémon in var `from` to the one in var `to`. */
registerCustom('moveCounters', (env, s, f, args, answer) => {
  const from = slotVar(s, f, String(args.from));
  const to = slotVar(s, f, String(args.to));
  if (!from || !to || from === to) return 'next';
  const all = statics(env, s);
  if (countersFixed(env, s, ownerOf(s, from), all) || countersFixed(env, s, ownerOf(s, to), all)) return 'next';
  // Moving counters onto a Pokémon is an effect of the Ability/attack (Hide 'n' Sneak stops it).
  if ((f.kind === 'ability' || f.kind === 'attack') && effectsPrevented(env, s, to, f.player, f.kind, all)) return 'next';
  const n = Math.min(Number(args.max ?? 3), Math.floor(from.damage / 10));
  if (n <= 0) return 'next';
  let k: number;
  if (answer !== undefined) k = ((answer as number[])[0] ?? 0) + 1;
  else if (n === 1) k = 1;
  else {
    const labels = Array.from({ length: n }, (_, i) => `Move ${i + 1} damage counter${i ? 's' : ''}`);
    return ask(s, { player: f.player, kind: 'option', prompt: 'Move how many damage counters?', min: 1, max: 1, labels }, 'index');
  }
  from.damage -= k * 10;
  to.damage += k * 10;
  emit(env, { type: 'counters', player: ownerOf(s, to), slot: to.id, n: k });
  return 'next';
});

// ---------------------------------------------------------------------------
// Drakloak, Recon Directive: look at the top N, 1 to hand, the rest to the bottom
// ---------------------------------------------------------------------------

registerCustom('lookTopPick', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const n = Number(args.n ?? 2);
  const top = ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse(); // top first
  if (!top.length) return 'next';
  let pick: number;
  if (answer !== undefined) pick = (answer as number[])[0] as number;
  else if (top.length === 1 || distinctDefs(env, top) === 1) pick = top[0] as number;
  else {
    return ask(
      s,
      { player: f.player, kind: 'cards', prompt: 'Put 1 into your hand (the other goes on the bottom of your deck)', min: 1, max: 1, values: top },
      'cards',
    );
  }
  for (const c of top) removeFrom(ps.deck, c);
  ps.knownTop = Math.max(0, ps.knownTop - top.length);
  ps.hand.push(pick);
  ps.deck.unshift(...top.filter((c) => c !== pick));
  return 'next';
});

// ---------------------------------------------------------------------------
// Crispin: Basic Energy of different types; pick which goes to hand
// ---------------------------------------------------------------------------

/** Choose up to 1 more Basic Energy from the deck whose type differs from every card in var `first`; var `as` = first + it. */
registerCustom('chooseEnergyOfOtherType', (env, s, f, args, answer) => {
  const first = cardsOf(f.vars[String(args.first)]);
  const as = String(args.as);
  if (answer !== undefined) {
    const pick = answer as number[];
    reveal(f, pick);
    f.vars[as] = [...first, ...pick];
    return 'next';
  }
  const types = new Set(first.flatMap((c) => def(env.ctx, c).provides));
  const opts = s.p[f.player].deck.filter((c) => {
    const d = def(env.ctx, c);
    return d.kind === 'energy' && d.basicEnergy && !d.provides.some((t) => types.has(t));
  });
  if (!opts.length) {
    f.vars[as] = first;
    return 'next';
  }
  return ask(s, { player: f.player, kind: 'cards', prompt: 'Search for a Basic Energy of a different type (or none)', min: 0, max: 1, values: opts }, 'cards');
});

/** Choose exactly `n` of the cards in var `from` into var `as`; the others land in var `rest`. */
registerCustom('pickFromVar', (_env, s, f, args, answer) => {
  const pool = cardsOf(f.vars[String(args.from)]);
  const n = Number(args.n ?? 1);
  let pick: number[];
  if (answer !== undefined) pick = answer as number[];
  else if (pool.length <= n) pick = pool.slice();
  else return ask(s, { player: f.player, kind: 'cards', prompt: String(args.prompt ?? `Choose ${n}`), min: n, max: n, values: pool }, 'cards');
  f.vars[String(args.as)] = pick;
  f.vars[String(args.rest)] = pool.filter((c) => !pick.includes(c));
  return 'next';
});

// ---------------------------------------------------------------------------
// Gengar ex, Tricky Steps: move an Energy from the opponent's Active to their Bench
// ---------------------------------------------------------------------------

registerCustom('moveOppActiveEnergy', (env, s, f, args, answer) => {
  const src = s.p[opp(f.player)].active;
  const to = slotVar(s, f, String(args.to));
  if (!src || !to || !src.energy.length) return 'next';
  const all = statics(env, s);
  if (effectsPrevented(env, s, src, f.player, 'attack', all) || effectsPrevented(env, s, to, f.player, 'attack', all)) return 'next';
  let c: number;
  if (answer !== undefined) c = (answer as number[])[0] as number;
  else if (distinctDefs(env, src.energy) === 1) c = src.energy[0] as number;
  else return ask(s, { player: f.player, kind: 'cards', prompt: 'Move which Energy?', min: 1, max: 1, values: src.energy.slice() }, 'cards');
  if (!removeFrom(src.energy, c)) return 'next';
  to.energy.push(c);
  return 'next';
});

// ---------------------------------------------------------------------------
// Rare Candy: evolve a Basic straight to Stage 2
// ---------------------------------------------------------------------------

const BASE_OF_STAGE1 = new WeakMap<GameContext, Map<string, string | null>>();

/** The Basic a Stage 1 named `stage1` evolves from: from this game's cards, else the frame snapshot. */
function stage1Base(env: Env, stage1: string): string | null {
  let m = BASE_OF_STAGE1.get(env.ctx);
  if (!m) BASE_OF_STAGE1.set(env.ctx, (m = new Map()));
  const hit = m.get(stage1);
  if (hit !== undefined) return hit;
  let base: string | null = null;
  const d = env.ctx.defs.find((x) => x.kind === 'pokemon' && x.stage === 1 && x.name === stage1 && x.evolvesFrom);
  if (d) base = d.evolvesFrom;
  else {
    for (const fr of Object.values(FRAMES)) {
      if (fr.category === 'Pokemon' && fr.stage === 'Stage1' && normText(fr.name) === stage1 && fr.evolvesFrom) {
        base = normText(fr.evolvesFrom);
        break;
      }
    }
  }
  m.set(stage1, base);
  return base;
}

/** A Basic Pokémon in play (a Pokémon card, or a Trainer played as a Basic Pokémon). */
function isBasicInPlay(d: CardDef): boolean {
  return d.stage === 0 && (d.kind === 'pokemon' || (d.kind === 'trainer' && !!d.script?.fix?.playAsBasic));
}

function candyStage2s(env: Env, s: GameState, p: Player, sl: Slot): number[] {
  const basic = def(env.ctx, topCard(sl)).name;
  return s.p[p].hand.filter((c) => {
    const d = def(env.ctx, c);
    return d.kind === 'pokemon' && d.stage === 2 && !!d.evolvesFrom && stage1Base(env, d.evolvesFrom) === basic;
  });
}

function candyBasics(env: Env, s: GameState, p: Player): Slot[] {
  return allSlots(s.p[p]).filter(
    (sl) => isBasicInPlay(def(env.ctx, topCard(sl))) && sl.enteredTurn < s.turn && candyStage2s(env, s, p, sl).length > 0,
  );
}

/** "You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn." */
registerCustomCond('rareCandyPlayable', (env, s, ec) => !ownFirstTurn(s, ec.player) && candyBasics(env, s, ec.player).length > 0);

registerCustom('rareCandy', (env, s, f, _args, answer) => {
  const p = f.player;
  let slotId = f.vars.__rcSlot as number | undefined;
  if (slotId === undefined) {
    if (answer !== undefined) slotId = (answer as number[])[0] as number;
    else {
      const basics = candyBasics(env, s, p);
      if (!basics.length) return 'next';
      if (basics.length > 1) {
        return ask(
          s,
          { player: p, kind: 'slots', prompt: 'Rare Candy: evolve which Basic Pokémon?', min: 1, max: 1, values: basics.map((b) => b.id) },
          'slots',
        );
      }
      slotId = (basics[0] as Slot).id;
    }
    f.vars.__rcSlot = slotId;
    answer = undefined;
  }
  const sl = findSlot(s, slotId)?.slot;
  const opts = sl ? candyStage2s(env, s, p, sl) : [];
  let card: number;
  if (answer !== undefined) card = (answer as number[])[0] as number;
  else if (!sl || !opts.length) {
    delete f.vars.__rcSlot;
    return 'next';
  } else if (distinctDefs(env, opts) === 1) card = opts[0] as number;
  else return ask(s, { player: p, kind: 'cards', prompt: 'Rare Candy: evolve into which Stage 2?', min: 1, max: 1, values: opts }, 'cards');
  delete f.vars.__rcSlot;
  if (!sl) return 'next';
  const ps = s.p[p];
  if (!removeFrom(ps.hand, card)) return 'next';
  removeFrom(ps.revealed, card);
  sl.cards.push(card);
  sl.evolvedTurn = s.turn;
  // Evolving clears Special Conditions and attack effects on the Pokémon.
  sl.cond = 0;
  s.effects = s.effects.filter((x) => !(x.slot === sl.id && x.fromAttack));
  emit(env, { type: 'evolve', player: p, card, slot: sl.id });
  queueTriggers(env, s, sl, p, 'evolveFromHand');
  return 'next';
});

// ---------------------------------------------------------------------------
// Antique fossils: "At any time during your turn, you may discard this card from play."
// ---------------------------------------------------------------------------

registerCustom('discardSelfFromPlay', (env, s, f) => {
  const loc = findSlot(s, f.slot);
  if (!loc) return 'next';
  const ps = s.p[loc.owner];
  if (ps.active === loc.slot) ps.active = null;
  else ps.bench = ps.bench.filter((b) => b !== loc.slot);
  s.effects = s.effects.filter((x) => x.slot !== loc.slot.id);
  const cards = slotCards(loc.slot);
  ps.discard.push(...cards);
  emit(env, { type: 'discard', player: loc.owner, cards });
  return 'next';
});
