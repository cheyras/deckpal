/**
 * Shared, cheap game knowledge for pilots: attack damage estimates through the
 * engine's own damage rules, Energy still missing for an attack, and per-deck
 * facts derived once from the card scripts (which cards fuel "count in your
 * discard pile" attacks, which attacks copy the top card of the deck).
 *
 * Everything here reads only what the asking player may see, or a
 * determinised copy of the state.
 */
import { def, type Env, type GameContext } from '../context.js';
import type { Cond, Expr, Filter, PType, Program, Step } from '../dsl.js';
import { defMatches, evalCond, evalExpr, type EvalCtx } from '../eval.js';
import {
  attackCost,
  damageIn,
  damageOut,
  damagePrevented,
  effectsPrevented,
  energyUnits,
  maxHp,
  type LiveStatic,
  weaknessOf,
} from '../query.js';
import { allSlots, opp, topCard } from '../state.js';
import type { CardDef, GameState, Player, Slot } from '../types.js';

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

/** How many more Energy units (of the right types) this cost needs from these units. */
export function missingUnits(cost: readonly PType[], units: readonly PType[]): number {
  const pool = units.slice();
  let missing = 0;
  let colorless = 0;
  for (const t of cost) {
    if (t === 'Colorless') {
      colorless++;
      continue;
    }
    const i = pool.indexOf(t);
    if (i < 0) missing++;
    else pool.splice(i, 1);
  }
  return missing + Math.max(0, colorless - pool.length);
}

// ---------------------------------------------------------------------------
// Per-deck facts (cached per context)
// ---------------------------------------------------------------------------

interface DeckFacts {
  /** def idx → true when a card of this def in its owner's discard pile raises one of the owner's attacks. */
  fuel: Set<number>[];
  /** def idx of attacks that copy the top card of the deck (Slowking). */
  copier: Set<number>;
  /** Prior estimate of a copied attack's damage from each player's 60 (fraction × average best). */
  copyPrior: [number, number];
  /** Best printed/scripted base damage per def (no board context), for role decisions. */
  power: number[];
  /** Per player: def idx of the deck's main attacker (highest power among its Pokémon). */
  mainAttacker: [number, number];
}

const FACTS = new WeakMap<GameContext, DeckFacts>();

function walkExpr(e: Expr | undefined, visit: (e: Expr) => void): void {
  if (e === undefined || typeof e === 'number') return;
  visit(e);
  if ('add' in e) e.add.forEach((x) => walkExpr(x, visit));
  else if ('sub' in e) e.sub.forEach((x) => walkExpr(x, visit));
  else if ('mul' in e) e.mul.forEach((x) => walkExpr(x, visit));
  else if ('min' in e) e.min.forEach((x) => walkExpr(x, visit));
  else if ('max' in e) e.max.forEach((x) => walkExpr(x, visit));
  else if ('cond' in e) {
    walkCond(e.cond, visit);
    walkExpr(e.then, visit);
    walkExpr(e.else, visit);
  }
}

function walkCond(c: Cond, visit: (e: Expr) => void): void {
  for (const k of ['gte', 'gt', 'lte', 'lt', 'eq'] as const) {
    if (k in c) (c as Record<string, Expr[]>)[k]!.forEach((x) => walkExpr(x, visit));
  }
  if ('and' in c) c.and.forEach((x) => walkCond(x, visit));
  if ('or' in c) c.or.forEach((x) => walkCond(x, visit));
  if ('not' in c) walkCond(c.not, visit);
}

function walkProgram(p: Program | undefined, visitStep: (s: Step) => void): void {
  for (const s of p ?? []) {
    visitStep(s);
    if (s.op === 'if') {
      walkProgram(s.then, visitStep);
      walkProgram(s.else, visitStep);
    } else if (s.op === 'repeat' || s.op === 'may') walkProgram(s.body, visitStep);
  }
}

function basePower(d: CardDef): number {
  let best = 0;
  for (const a of d.attacks) {
    let n = a.baseDamage;
    const sc = d.coverage === 'full' ? d.script?.attacks?.[a.name] : undefined;
    walkProgram(sc?.program, (st) => {
      if (st.op === 'counters' && typeof st.n === 'number') n = Math.max(n, st.n * 10);
      if (st.op === 'damage' && typeof st.amount === 'number') n = Math.max(n, st.amount);
    });
    // "You may ... for N more damage" (a `set` inside the attack's `pre`): count the bonus.
    let bonus = 0;
    walkProgram(sc?.pre, (st) => {
      if (st.op === 'set' && typeof st.value === 'number') bonus = Math.max(bonus, st.value);
    });
    best = Math.max(best, n + bonus);
  }
  return best;
}

export function facts(ctx: GameContext): DeckFacts {
  let f = FACTS.get(ctx);
  if (f) return f;
  const fuel: Set<number>[] = [new Set(), new Set()];
  const copier = new Set<number>();
  const power = ctx.defs.map(basePower);
  const copyPrior: [number, number] = [0, 0];
  const mainAttacker: [number, number] = [-1, -1];
  for (const p of [0, 1] as Player[]) {
    const defsOf = [...new Set(ctx.iids[p].map((i) => ctx.cardDef[i] as number))].map((i) => ctx.defs[i] as CardDef);
    const filters: Filter[] = [];
    for (const d of defsOf) {
      if (d.kind !== 'pokemon' || d.coverage !== 'full') continue;
      for (const a of d.attacks) {
        const sc = d.script?.attacks?.[a.name];
        if (!sc) continue;
        const visit = (e: Expr) => {
          if (typeof e === 'object' && 'count' in e && e.count.zone === 'discard' && (e.count.who ?? 'self') === 'self') {
            filters.push(e.count.filter ?? {});
          }
        };
        walkExpr(sc.damage, visit);
        walkProgram(sc.program, (st) => {
          if (st.op === 'if') walkCond(st.cond, visit);
          if (st.op === 'useAttackOf') copier.add(d.idx);
        });
        walkProgram(sc.pre, (st) => {
          if (st.op === 'if') walkCond(st.cond, visit);
        });
      }
    }
    for (const d of defsOf) if (filters.some((fl) => defMatches(d, fl))) fuel[p]!.add(d.idx);
    // Copy prior: fraction of non-Rule-Box Pokémon in the 60 × their average best damage.
    let n = 0;
    let sum = 0;
    for (const i of ctx.iids[p]) {
      const d = def(ctx, i);
      if (d.kind === 'pokemon' && !d.ruleBox) {
        n++;
        sum += power[d.idx] ?? 0;
      }
    }
    copyPrior[p] = n ? (sum / ctx.iids[p].length) : 0;
    let best = -1;
    let bestPow = -1;
    for (const d of defsOf) {
      if (d.kind !== 'pokemon') continue;
      const pw = (power[d.idx] ?? 0) / Math.max(1, d.attacks[0]?.cost.length ?? 1) + (power[d.idx] ?? 0);
      if (pw > bestPow) {
        bestPow = pw;
        best = d.idx;
      }
    }
    mainAttacker[p] = best;
  }
  f = { fuel, copier, copyPrior, power, mainAttacker };
  FACTS.set(ctx, f);
  return f;
}

// ---------------------------------------------------------------------------
// Damage estimates (the engine's damage pipeline, without side effects)
// ---------------------------------------------------------------------------

/** Damage `base` from `attacker` (owned by `owner`) would do to `target`, through W/R and modifiers. */
export function throughPipeline(env: Env, s: GameState, attacker: Slot, owner: Player, target: Slot, base: number, all: LiveStatic[]): number {
  if (base <= 0) return 0;
  const tOwner: Player = s.p[0].active === target || s.p[0].bench.includes(target) ? 0 : 1;
  const isActive = s.p[tOwner].active === target;
  let dmg = base;
  if (tOwner !== owner && isActive) {
    dmg += damageOut(env, s, attacker, target, all);
    const w = weaknessOf(env, s, target, all);
    const types = def(env.ctx, topCard(attacker)).types;
    if (w && types.includes(w)) dmg *= 2;
    const r = def(env.ctx, topCard(target)).resistance;
    if (r && types.includes(r.type)) dmg -= r.amount;
  }
  if (dmg > 0) dmg += damageIn(env, s, target, all);
  if (dmg <= 0) return 0;
  if (damagePrevented(env, s, target, owner, all)) return 0;
  return dmg;
}

function programDamage(
  env: Env,
  s: GameState,
  prog: Program,
  ec: EvalCtx,
  attacker: Slot,
  owner: Player,
  target: Slot,
  all: LiveStatic[],
  depth: number,
): number {
  let total = 0;
  for (const st of prog) {
    switch (st.op) {
      case 'damage': {
        const amt = evalExpr(env, s, ec, st.amount);
        total += throughPipeline(env, s, attacker, owner, target, amt, all);
        break;
      }
      case 'counters': {
        const n = evalExpr(env, s, ec, st.n);
        if (!effectsPrevented(env, s, target, owner, 'attack', all)) total += n * 10;
        break;
      }
      case 'knockOut':
        if (st.target === 'oppActive' || st.target === 'defender') total += 999;
        break;
      case 'if':
        total += programDamage(env, s, evalCond(env, s, ec, st.cond) ? st.then : (st.else ?? []), ec, attacker, owner, target, all, depth);
        break;
      case 'useAttackOf':
        total += copyEstimate(env, s, attacker, owner, target, all, depth);
        break;
      default:
        break;
    }
  }
  return total;
}

/** What a "copy the top card's attack" attack is worth: exact when the top card is known, else a prior. */
function copyEstimate(env: Env, s: GameState, attacker: Slot, owner: Player, target: Slot, all: LiveStatic[], depth: number): number {
  if (depth > 0) return 0;
  const ps = s.p[owner];
  if (ps.knownTop > 0 && ps.deck.length) {
    const top = ps.deck[ps.deck.length - 1] as number;
    const d = def(env.ctx, top);
    if (d.kind !== 'pokemon' || d.ruleBox) return 0;
    let best = 0;
    for (let i = 0; i < d.attacks.length; i++) best = Math.max(best, attackDamageOfDef(env, s, d, i, attacker, owner, target, all, depth + 1));
    return best;
  }
  return facts(env.ctx).copyPrior[owner];
}

function presetVars(env: Env, s: GameState, prog: Program, ec: EvalCtx): void {
  for (const st of prog) {
    if (st.op === 'set') ec.vars[st.v] = evalExpr(env, s, ec, st.value);
    else if (st.op === 'flip') ec.vars[st.as] = 0;
    else if (st.op === 'may') presetVars(env, s, st.body, ec);
    else if (st.op === 'if' && evalCond(env, s, ec, st.cond)) presetVars(env, s, st.then, ec);
  }
}

function attackDamageOfDef(
  env: Env,
  s: GameState,
  d: CardDef,
  idx: number,
  attacker: Slot,
  owner: Player,
  target: Slot,
  all: LiveStatic[],
  depth: number,
): number {
  const atk = d.attacks[idx];
  if (!atk) return 0;
  const sc = d.coverage === 'full' ? d.script?.attacks?.[atk.name] : undefined;
  const ec: EvalCtx = { player: owner, slot: attacker.id, defender: target.id, vars: {} };
  if (sc?.program) return programDamage(env, s, sc.program, ec, attacker, owner, target, all, depth);
  // Variables the attack sets before damage: "you may" bonuses count as taken (the policy says yes);
  // coin flips count as 0 heads (an estimate for KO certainty should not hope).
  if (sc?.pre) presetVars(env, s, sc.pre, ec);
  const base = sc?.damage !== undefined ? evalExpr(env, s, ec, sc.damage) : atk.baseDamage;
  let dmg = throughPipeline(env, s, attacker, owner, target, base, all);
  if (sc?.post) dmg += programDamage(env, s, sc.post, ec, attacker, owner, target, all, depth);
  return dmg;
}

/** Estimated damage of attack `idx` of card `d` used by `attacker` (a copied attack: the attacker's types apply). */
export function attackDamageWithDef(env: Env, s: GameState, d: CardDef, idx: number, attacker: Slot, owner: Player, target: Slot, all: LiveStatic[]): number {
  return attackDamageOfDef(env, s, d, idx, attacker, owner, target, all, 1);
}

/** Estimated damage of `attacker`'s attack `idx` against `target` (ignores coin flips: heads count 0). */
export function attackDamage(env: Env, s: GameState, attacker: Slot, owner: Player, idx: number, target: Slot, all: LiveStatic[]): number {
  return attackDamageOfDef(env, s, def(env.ctx, topCard(attacker)), idx, attacker, owner, target, all, 0);
}

export interface Threat {
  /** Best damage this Pokémon can do to the target with `extra` more Energy (any type). */
  dmg: number;
  /** Energy units still missing for that attack (beyond `extra`). */
  missing: number;
}

/**
 * Best attack of `attacker` against `target` given `extra` additional Energy
 * units of any type. Returns the highest damage among payable attacks, and for
 * the strongest attack overall how many units are still missing.
 */
export function bestAttack(env: Env, s: GameState, attacker: Slot, owner: Player, target: Slot, extra: number, all: LiveStatic[]): Threat {
  const d = def(env.ctx, topCard(attacker));
  const units = energyUnits(env, attacker);
  let dmg = 0;
  let bestMissing = 99;
  let bestAny = 0;
  for (let i = 0; i < d.attacks.length; i++) {
    const cost = attackCost(env, s, attacker, i, all);
    const miss = missingUnits(cost, units);
    const dd = attackDamage(env, s, attacker, owner, i, target, all);
    if (miss <= extra && dd > dmg) dmg = dd;
    if (dd > bestAny || (dd === bestAny && miss < bestMissing)) {
      bestAny = dd;
      bestMissing = Math.max(0, miss - extra);
    }
  }
  return { dmg, missing: bestAny > 0 ? bestMissing : 99 };
}

export function hpLeft(env: Env, s: GameState, sl: Slot, all: LiveStatic[]): number {
  return maxHp(env, s, sl, all) - sl.damage;
}

export function prizeValue(env: Env, sl: Slot): number {
  return def(env.ctx, topCard(sl)).prizeValue;
}

/** Does this player's hand hold an Energy card it could attach? (own hand only — callers pass their own seat or a determinised copy.) */
export function handHasEnergy(env: Env, s: GameState, p: Player): boolean {
  for (const c of s.p[p].hand) if (def(env.ctx, c).kind === 'energy') return true;
  return false;
}

export { allSlots, opp, topCard };
