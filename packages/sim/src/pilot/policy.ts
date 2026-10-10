/**
 * The heuristic default answer for EVERY decision kind. Cheap pilots use it
 * directly; search uses it for the sub-decisions it does not branch on.
 *
 * It reads the decision (whose options the chooser can see), the chooser's own
 * hand and board, and public information. It never reads the opponent's hand,
 * either deck's order or face-down Prize cards — with one exception that is
 * safe by construction: inside search it runs on a determinised copy, where
 * those zones are samples, not the truth.
 *
 * The effect being resolved is read from the top interpreter frame (which card,
 * which step, where the chosen cards go next), so "choose cards" means the
 * right thing: a search fetches what the board needs, a discard cost throws away
 * what is least useful, a deck-top choice feeds a copy attack.
 */
import { codeOf, def, type Env } from '../context.js';
import type { Op } from '../compile.js';
import type { Step } from '../dsl.js';
import { evalExpr } from '../eval.js';
import { attackCost, energyUnits, retreatCost, statics, type LiveStatic } from '../query.js';
import type { Game } from '../game.js';
import { opp } from '../state.js';
import type { Pilot } from './types.js';
import type { Action, CardDef, Decision, Frame, GameState, Player, Slot } from '../types.js';
import {
  allSlots,
  attackDamage as attackDamageAt,
  attackDamageWithDef,
  bestAttack,
  facts,
  hpLeft,
  missingUnits,
  prizeValue,
  throughPipeline,
  topCard,
} from './knowledge.js';

export interface PolicyProfile {
  /** Go first when winning the coin toss (default true). */
  goFirst: boolean;
}

export const DEFAULT_PROFILE: PolicyProfile = { goFirst: true };

const MISSING_DISCOUNT = [1, 0.55, 0.3, 0.15, 0.08];

// ---------------------------------------------------------------------------
// Context: which effect is asking, and what happens to the answer
// ---------------------------------------------------------------------------

interface Ask {
  frame: Frame | null;
  step: Step | null;
  /** Where the chosen cards/slots go next. */
  dest: string | null;
  /** For damage/counter targets: the amount (damage) or counters×10. */
  amount: number;
  counters: boolean;
}

function askContext(env: Env, s: GameState): Ask {
  const f = s.stack[s.stack.length - 1] ?? null;
  const out: Ask = { frame: f, step: null, dest: null, amount: 0, counters: false };
  if (!f) return out;
  const code = codeOf(env.ctx, f.code);
  const op = code[f.pc] as Op | undefined;
  if (op && op.o === 'step') out.step = op.s;
  const as = out.step && 'as' in out.step ? (out.step as { as?: string }).as : undefined;
  if (!as) return out;
  for (let i = f.pc + 1; i < code.length; i++) {
    const o = code[i] as Op;
    if (o.o !== 'step') continue;
    const st = o.s;
    if (st.op === 'move' && st.cards === as) {
      out.dest = st.to;
      break;
    }
    if (st.op === 'attach' && (st.cards === as || (typeof st.to === 'object' && st.to.v === as))) {
      out.dest = 'attach';
      break;
    }
    if (st.op === 'custom' && st.args?.cards === as) {
      out.dest = 'deckTop';
      break;
    }
    if (st.op === 'putOnTop' && st.cards === as) {
      out.dest = 'deckTop';
      break;
    }
    if (st.op === 'damage' && typeof st.to === 'object' && 'v' in st.to && st.to.v === as) {
      out.dest = 'damage';
      out.amount = evalExpr(env, s, { player: f.player, slot: f.slot, vars: f.vars }, st.amount);
      break;
    }
    if (st.op === 'counters' && typeof st.to === 'object' && 'v' in st.to && st.to.v === as) {
      out.dest = 'damage';
      out.counters = true;
      out.amount = evalExpr(env, s, { player: f.player, slot: f.slot, vars: f.vars }, st.n) * 10;
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Card values
// ---------------------------------------------------------------------------

function trainerKind(d: CardDef): { draws: boolean; searches: boolean; gust: boolean } {
  const prog = d.script?.play ?? [];
  let draws = false;
  let searches = false;
  let gust = false;
  const walk = (p: Step[]) => {
    for (const st of p) {
      if (st.op === 'draw') draws = true;
      if (st.op === 'chooseCards' && st.from === 'deck') searches = true;
      if (st.op === 'switch' && st.who === 'opp') gust = true;
      if (st.op === 'if') {
        walk(st.then);
        walk(st.else ?? []);
      }
    }
  };
  walk(prog);
  return { draws, searches, gust };
}

interface Board {
  env: Env;
  s: GameState;
  p: Player;
  all: LiveStatic[];
  /** Names on top of my Pokémon in play (that can still evolve). */
  inPlay: Map<string, number>;
  handNames: Map<string, number>;
  needEnergy: boolean;
  pokemonCount: number;
  copier: boolean;
}

function board(env: Env, s: GameState, p: Player): Board {
  const ps = s.p[p];
  const all = statics(env, s);
  const inPlay = new Map<string, number>();
  let needEnergy = false;
  const fx = facts(env.ctx);
  let copier = false;
  for (const sl of allSlots(ps)) {
    const d = def(env.ctx, topCard(sl));
    inPlay.set(d.name, (inPlay.get(d.name) ?? 0) + 1);
    if (fx.copier.has(d.idx)) copier = true;
    const units = energyUnits(env, sl);
    for (let i = 0; i < d.attacks.length; i++) {
      if (missingUnits(attackCost(env, s, sl, i, all), units) > 0 && (fx.power[d.idx] ?? 0) > 0) needEnergy = true;
    }
  }
  const handNames = new Map<string, number>();
  for (const c of ps.hand) {
    const n = def(env.ctx, c).name;
    handNames.set(n, (handNames.get(n) ?? 0) + 1);
  }
  return { env, s, p, all, inPlay, handNames, needEnergy, pokemonCount: allSlots(ps).length, copier };
}

/** How much this card is worth to `p` right now (higher = keep / fetch). */
function cardValue(b: Board, c: number): number {
  const d = def(b.env.ctx, c);
  const ps = b.s.p[b.p];
  const fx = facts(b.env.ctx);
  if (d.kind === 'pokemon') {
    if (d.stage > 0) {
      if (d.evolvesFrom && b.inPlay.has(d.evolvesFrom)) return 75 + 10 * d.stage;
      if (d.evolvesFrom && b.handNames.has(d.evolvesFrom)) return 45;
      return 22;
    }
    let v = b.pokemonCount < 3 ? 62 : b.pokemonCount < 5 ? 40 : 18;
    if (ps.bench.length >= 5) v = 12;
    // A Basic whose evolution is in the list is worth developing.
    const evolves = b.env.ctx.defs.some((x) => x.evolvesFrom === d.name && x.kind === 'pokemon');
    if (evolves) v += 8;
    if (d.idx === fx.mainAttacker[b.p]) v += 10;
    if (d.prizeValue > 1) v -= 6;
    return v + (fx.power[d.idx] ?? 0) / 40;
  }
  if (d.kind === 'energy') return b.needEnergy ? 52 : 26;
  // Trainers
  const k = trainerKind(d);
  if (d.ttype === 'supporter') {
    let v = 40;
    if (k.draws) v += ps.hand.length <= 4 ? 22 : 8;
    if (k.gust) v += 6;
    return v;
  }
  if (d.ttype === 'item') return d.aceSpec ? 46 : k.searches ? 42 : 32;
  if (d.ttype === 'tool') return 26;
  if (d.ttype === 'stadium') return 22;
  return 20;
}

/** What a card in the discard pile is worth instead (fuel for "count in your discard" attacks). */
function discardBonus(b: Board, c: number): number {
  return facts(b.env.ctx).fuel[b.p]!.has(b.env.ctx.cardDef[c] as number) ? 24 : 0;
}

/** For a top-deck copier: how good is this card to have on top? */
function copyValue(b: Board, c: number): number {
  const d = def(b.env.ctx, c);
  if (d.kind !== 'pokemon' || d.ruleBox) return -1;
  return facts(b.env.ctx).power[d.idx] ?? 0;
}

/** Pick `k` options by a score, with diminishing returns for repeated card definitions. */
function topK(env: Env, values: number[], k: number, score: (c: number) => number, byDef = true): number[] {
  const scored = values.map((c, i) => ({ i, c, v: score(c) }));
  const picked: number[] = [];
  const usedDefs = new Map<number, number>();
  for (let n = 0; n < k; n++) {
    let best = -1;
    let bestV = -Infinity;
    for (const x of scored) {
      if (picked.includes(x.i)) continue;
      const dup = byDef ? (usedDefs.get(env.ctx.cardDef[x.c] as number) ?? 0) : 0;
      const v = x.v - dup * 22;
      if (v > bestV) {
        bestV = v;
        best = x.i;
      }
    }
    if (best < 0) break;
    picked.push(best);
    const di = env.ctx.cardDef[values[best] as number] as number;
    usedDefs.set(di, (usedDefs.get(di) ?? 0) + 1);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Slot values
// ---------------------------------------------------------------------------

/** How good this Pokémon of mine is as my Active (promote, switch, setup). */
function activeValue(b: Board, sl: Slot): number {
  const { env, s, p, all } = b;
  const them = s.p[opp(p)];
  const d = def(env.ctx, topCard(sl));
  let v = hpLeft(env, s, sl, all) / 6 - retreatCost(env, s, sl, all) * 6;
  if (them.active) {
    const t = bestAttack(env, s, sl, p, them.active, 1, all);
    const left = hpLeft(env, s, them.active, all);
    const disc = MISSING_DISCOUNT[Math.min(t.missing, 4)] as number;
    v += t.dmg >= left ? 260 * prizeValue(env, them.active) : t.dmg * 0.8;
    v += disc * 40;
    // Exposure: can their Active Knock it Out next turn?
    const back = bestAttack(env, s, them.active, opp(p), sl, 1, all);
    if (back.dmg >= hpLeft(env, s, sl, all)) v -= 120 * d.prizeValue;
  }
  return v;
}

/** How good a target this opponent's Pokémon is for damage/counters of `amount`. */
function targetValue(b: Board, sl: Slot, amount: number, counters: boolean, attacker: Slot | null): number {
  const { env, s, p, all } = b;
  const left = hpLeft(env, s, sl, all);
  const dmg = counters || !attacker ? amount : throughPipeline(env, s, attacker, p, sl, amount, all);
  const pv = prizeValue(env, sl);
  if (dmg >= left) return 1000 * pv + (s.p[opp(p)].active === sl ? 20 : 0);
  return (dmg / Math.max(10, left)) * 100 * pv + (dmg > 0 ? 5 : -100);
}

/** Gust (Boss's Orders): which of their Benched Pokémon to drag up. */
function gustValue(b: Board, sl: Slot): number {
  const { env, s, p, all } = b;
  const me = s.p[p];
  const them = s.p[opp(p)];
  let best = 0;
  // Temporarily see it as the Active so Weakness/Resistance apply to the estimate.
  const oldActive = them.active;
  const oldBench = them.bench;
  them.active = sl;
  them.bench = oldBench.filter((x) => x !== sl);
  try {
    const left = hpLeft(env, s, sl, all);
    for (const a of allSlots(me)) {
      const t = bestAttack(env, s, a, p, sl, me.energyAttached ? 0 : 1, all);
      const f = a === me.active ? 1 : 0.4;
      const v = t.dmg >= left ? 1000 * prizeValue(env, sl) * f : (t.dmg / Math.max(10, left)) * 80 * f;
      if (v > best) best = v;
    }
    // Stall value: a Pokémon that can't attack and is hard to retreat.
    best += retreatCost(env, s, sl, all) * 8 - energyUnits(env, sl).length * 4;
  } finally {
    them.active = oldActive;
    them.bench = oldBench;
  }
  return best;
}

/** Which of my Pokémon most needs an Energy (Wondrous Patch-style attaches). */
function needValue(b: Board, sl: Slot): number {
  const { env, s, p, all } = b;
  const d = def(env.ctx, topCard(sl));
  const them = s.p[opp(p)];
  const pw = facts(env.ctx).power[d.idx] ?? 0;
  if (!them.active) return pw;
  const t = bestAttack(env, s, sl, p, them.active, 0, all);
  return pw + (t.missing > 0 && t.missing < 99 ? 60 / t.missing : 0) + (sl === s.p[p].active ? 10 : 0);
}

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

function count(d: Decision): number {
  return d.actions?.length ?? d.values?.length ?? d.labels?.length ?? 0;
}

function setupActive(b: Board, d: Decision): number[] {
  const values = d.values as number[];
  const fx = facts(b.env.ctx);
  let best = 0;
  let bestV = -Infinity;
  values.forEach((c, i) => {
    const x = def(b.env.ctx, c);
    let v = -x.retreat * 12 - (x.prizeValue - 1) * 35 + Math.min(x.hp, 160) / 8;
    if (x.attacks.some((a) => a.cost.length <= 1 && (a.baseDamage > 0 || a.text))) v += 8;
    const evolves = b.env.ctx.defs.some((y) => y.evolvesFrom === x.name);
    if (evolves) v -= 6; // keep evolvers safe on the Bench
    if (x.idx === fx.mainAttacker[b.p] && values.some((o) => def(b.env.ctx, o).idx !== x.idx)) v -= 25;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  });
  return [best];
}

function setupBench(b: Board, d: Decision): number[] {
  const values = d.values as number[];
  const singles: number[] = [];
  const multis: number[] = [];
  values.forEach((c, i) => (def(b.env.ctx, c).prizeValue > 1 ? multis : singles).push(i));
  const out = singles.slice(0, d.max);
  // A multi-Prize Basic is a liability on the Bench; bench one only when the Bench would be thin.
  if (out.length < 2 && multis.length && out.length < d.max) out.push(multis[0] as number);
  return out.slice(0, d.max).length >= d.min ? out.slice(0, d.max) : Array.from({ length: d.min }, (_, i) => i);
}

function chooseCards(b: Board, d: Decision, ask: Ask): number[] {
  const { env, s, p } = b;
  const values = d.values as number[];
  const ps = s.p[p];
  const first = values[0] as number;
  const k = (n: number) => Math.max(d.min, Math.min(d.max, n));
  // Energy on a Pokémon (retreat cost, attack costs): keep what it needs.
  if (ask.step?.op === 'discardEnergy' || (!ps.hand.includes(first) && !ps.deck.includes(first) && !ps.discard.includes(first))) {
    return topK(env, values, d.min, (c) => {
      const x = def(env.ctx, c);
      let v = 0;
      if (x.script?.reattachAfterOwnAttack && ask.frame?.kind === 'attack') v += 50;
      if (!x.basicEnergy) v -= 10; // Special Energy is worth more on board
      return v;
    }, false);
  }
  const fromHand = ps.hand.includes(first);
  const fromDeck = ps.deck.includes(first) || ps.prizes.includes(first);
  if (fromHand) {
    if (ask.dest === 'deckTop') {
      // Academy at Night: feed a top-deck copier, else keep the best card for next turn.
      return topK(env, values, k(1), (c) => (b.copier ? copyValue(b, c) * 2 : 0) + cardValue(b, c), false);
    }
    // Discards. A cost (min = max) throws away the least useful; "up to" discards pay off only
    // when they draw (Gwynn: draw 3 per card) or fuel a discard-counting attack.
    const src = ask.frame ? def(env.ctx, ask.frame.src) : null;
    const draws = !!src && trainerKind(src).draws;
    const score = (c: number) => -(cardValue(b, c) - discardBonus(b, c));
    if (d.min === d.max) return topK(env, values, d.min, score, false);
    if (draws) return topK(env, values, d.max, score, false);
    const fuel = values.map((c, i) => ({ c, i })).filter((x) => discardBonus(b, x.c) > 0 && cardValue(b, x.c) < 40);
    const n = k(fuel.length);
    return n === fuel.length ? fuel.map((x) => x.i) : topK(env, values, n, score, false);
  }
  if (ask.dest === 'deckTop') {
    // Ciphermaniac's: two cards on top.
    return topK(env, values, k(d.max), (c) => (b.copier ? copyValue(b, c) * 2 : 0) + cardValue(b, c));
  }
  if (ask.dest === 'bench') {
    // Onto the Bench from the deck: as many useful Basics as allowed; one multi-Prize at most.
    return topK(env, values, k(d.max), (c) => cardValue(b, c) - (def(env.ctx, c).prizeValue - 1) * 30);
  }
  if (ask.dest === 'attach') return topK(env, values, k(d.max), () => 0, false);
  // Searching the deck / recovering from the discard pile: take the best, as many as allowed.
  void fromDeck;
  return topK(env, values, k(d.max), (c) => cardValue(b, c));
}

function chooseSlots(b: Board, d: Decision, ask: Ask): number[] {
  const { env, s, p } = b;
  const ids = d.values as number[];
  const slotOf = (id: number) => allSlots(s.p[0]).find((x) => x.id === id) ?? allSlots(s.p[1]).find((x) => x.id === id);
  const mine = allSlots(s.p[p]).some((x) => x.id === ids[0]);
  const n = Math.max(d.min, Math.min(d.max, ids.length));
  let score: (sl: Slot) => number;
  if (ask.dest === 'damage') {
    const attacker = ask.frame ? (slotOf(ask.frame.slot) ?? null) : null;
    score = (sl) => (mine ? -targetValue(b, sl, ask.amount, ask.counters, attacker) : targetValue(b, sl, ask.amount, ask.counters, attacker));
  } else if (ask.dest === 'attach') score = (sl) => (mine ? needValue(b, sl) : -needValue(b, sl));
  else if (mine) score = (sl) => activeValue(b, sl);
  else if (ask.step?.op === 'switch') score = (sl) => gustValue(b, sl);
  else score = (sl) => -activeValue({ ...b, p: opp(p) }, sl);
  const scored = ids.map((id, i) => ({ i, v: score(slotOf(id) as Slot) }));
  scored.sort((x, y) => y.v - x.v);
  return scored.slice(0, n).map((x) => x.i);
}

function chooseOption(b: Board, d: Decision, ask: Ask): number[] {
  const { env, s, p, all } = b;
  // A copied attack (Seek Inspiration): the strongest one against the Defending Pokémon.
  const f = ask.frame;
  if (f && ask.step?.op === 'useAttackOf') {
    const v = f.vars[ask.step.card];
    const card = Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined;
    const attacker = allSlots(s.p[p]).find((x) => x.id === f.slot);
    const target = s.p[opp(p)].active;
    if (card !== undefined && attacker && target) {
      const x = def(env.ctx, card);
      // Each copied attack, used by the attacker (its types apply), against the Defending Pokémon.
      let best = 0;
      let bestV = -1;
      const left = hpLeft(env, s, target, all);
      x.attacks.forEach((_a, i) => {
        const dmg = attackDamageWithDef(env, s, x, i, attacker, p, target, all);
        const val = dmg >= left ? 1000 + dmg : dmg;
        if (val > bestV) {
          bestV = val;
          best = i;
        }
      });
      return [best];
    }
  }
  return [0];
}


// ---------------------------------------------------------------------------
// Main-phase heuristic (cheap pilots only; search branches main decisions itself)
// ---------------------------------------------------------------------------

function mainChoice(b: Board, d: Decision): number[] {
  const { env, s, p, all } = b;
  const acts = d.actions as Action[];
  const ps = s.p[p];
  const them = s.p[opp(p)];
  let best = acts.length - 1;
  let bestV = -Infinity;
  acts.forEach((a, i) => {
    let v = 0;
    switch (a.t) {
      case 'evolve':
        v = 90;
        break;
      case 'bench':
        v = ps.bench.length < 3 ? 70 : 25 - def(env.ctx, a.card).prizeValue * 10;
        break;
      case 'attach': {
        const sl = allSlots(ps).find((x) => x.id === a.slot) as Slot;
        v = 50 + (them.active ? Math.min(40, bestAttack(env, s, sl, p, them.active, 1, all).dmg / 5) : 0) + (sl === ps.active ? 10 : 0);
        break;
      }
      case 'trainer': {
        const x = def(env.ctx, a.card);
        const k = trainerKind(x);
        v = x.ttype === 'supporter' ? (k.draws ? 60 - ps.hand.length * 3 : 45) : k.searches ? 65 : 40;
        break;
      }
      case 'tool':
        v = 30;
        break;
      case 'ability':
        v = 55;
        break;
      case 'stadium':
        v = 5;
        break;
      case 'retreat':
        v = -10;
        break;
      case 'attack':
        v = 10;
        break;
      case 'end':
        v = 0;
        break;
    }
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  });
  // Attack once nothing better is left: the strongest attack.
  if (acts[best]?.t === 'end' || (bestV <= 10 && acts.some((a) => a.t === 'attack'))) {
    let ai = -1;
    let aDmg = -1;
    acts.forEach((a, i) => {
      if (a.t !== 'attack' || !ps.active || !them.active) return;
      const dmg = attackDamageAt(env, s, ps.active, p, a.idx, them.active, all);
      if (dmg > aDmg) {
        aDmg = dmg;
        ai = i;
      }
    });
    if (ai >= 0) return [ai];
  }
  return [best];
}

/** The policy's answer to any decision. */
export function policyChoose(env: Env, s: GameState, d: Decision, profile: PolicyProfile = DEFAULT_PROFILE): number[] {
  const n = count(d);
  if (n === 0) return [];
  if (d.min === d.max && d.max === n && d.kind !== 'order') return Array.from({ length: n }, (_, i) => i);
  switch (d.kind) {
    case 'goFirst':
      return [profile.goFirst ? 0 : 1];
    case 'mulliganDraws':
      return [n - 1];
    case 'yesno':
      return [0];
    default:
      break;
  }
  const b = board(env, s, d.player);
  switch (d.kind) {
    case 'main':
      return mainChoice(b, d);
    case 'setupActive':
      return setupActive(b, d);
    case 'setupBench':
      return setupBench(b, d);
    case 'promote': {
      const ids = d.values as number[];
      const ps = s.p[d.player];
      let best = 0;
      let bestV = -Infinity;
      ids.forEach((id, i) => {
        const sl = ps.bench.find((x) => x.id === id);
        if (!sl) return;
        const v = activeValue(b, sl);
        if (v > bestV) {
          bestV = v;
          best = i;
        }
      });
      return [best];
    }
    case 'cards':
      return chooseCards(b, d, askContext(env, s));
    case 'slots':
      return chooseSlots(b, d, askContext(env, s));
    case 'option':
      return chooseOption(b, d, askContext(env, s));
    case 'order': {
      const values = d.values as number[];
      const scored = values.map((c, i) => ({ i, v: (b.copier ? copyValue(b, c) * 2 : 0) + cardValue(b, c) }));
      scored.sort((x, y) => y.v - x.v);
      return scored.map((x) => x.i);
    }
    default:
      return Array.from({ length: d.min }, (_, i) => i);
  }
}

/** A pilot that plays the policy directly: fast, no lookahead. */
export class PolicyPilot implements Pilot {
  readonly name = 'policy';
  constructor(private profile: PolicyProfile = DEFAULT_PROFILE) {}
  choose(game: Game, d: Decision): number[] {
    return policyChoose(game.envForInternals, game.state, d, this.profile);
  }
}
