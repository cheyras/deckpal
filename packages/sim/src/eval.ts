/**
 * Evaluate filters, expressions and conditions. Pure reads of the state, from
 * the point of view of an effect's controller (`ec.player`) and source Pokémon.
 */
import { def, type Env } from './context.js';
import type { Cond, Expr, Filter, SlotRef, SlotZone, SpecialCondition, Who } from './dsl.js';
import { allSlots, findSlot, opp, topCard } from './state.js';
import type { CardDef, GameState, Player, Slot, Val } from './types.js';
import { ASLEEP, BURNED, CONFUSED, PARALYZED, POISONED } from './types.js'; // lane:metal

export interface EvalCtx {
  player: Player;
  /** Source slot id (0 = none). */
  slot: number;
  /** The Defending Pokémon's slot id when an attack is resolving (0 = none). */
  defender?: number;
  vars: Record<string, Val>;
}

export function side(ec: EvalCtx, who: Who | undefined): Player {
  return who === 'opp' ? opp(ec.player) : ec.player;
}

function typeMatch(types: readonly string[], t: Filter['type']): boolean {
  if (!t) return true;
  const want = Array.isArray(t) ? t : [t];
  return types.some((x) => want.includes(x as never));
}

/** Does a card definition match a filter? (Pokémon-in-play extras are checked by slotMatches.) */
export function defMatches(d: CardDef, f: Filter | undefined): boolean {
  if (!f) return true;
  if (f.cat && d.kind !== f.cat) return false;
  if (f.stage) {
    if (d.kind !== 'pokemon') return false;
    if (f.stage === 'basic' && d.stage !== 0) return false;
    if (f.stage === 'stage1' && d.stage !== 1) return false;
    if (f.stage === 'stage2' && d.stage !== 2) return false;
    if (f.stage === 'evolution' && d.stage === 0) return false;
  }
  if (f.ruleBox !== undefined && (d.kind !== 'pokemon' || d.ruleBox !== f.ruleBox)) return false;
  if (f.ex !== undefined && d.ex !== f.ex) return false;
  if (f.mega !== undefined && d.mega !== f.mega) return false;
  if (f.tera !== undefined && d.tera !== f.tera) return false;
  if (f.type && (d.kind !== 'pokemon' || !typeMatch(d.types, f.type))) return false;
  if (f.hpMax !== undefined && (d.kind !== 'pokemon' || d.hp > f.hpMax)) return false;
  if (f.ttype && d.ttype !== f.ttype) return false;
  if (f.basicEnergy !== undefined && (d.kind !== 'energy' || d.basicEnergy !== f.basicEnergy)) return false;
  if (f.energyType && !(d.kind === 'energy' && d.basicEnergy && d.provides.includes(f.energyType))) return false;
  if (f.name) {
    const names = Array.isArray(f.name) ? f.name : [f.name];
    if (!names.includes(d.name)) return false;
  }
  if (f.nameIncludes && !d.name.includes(f.nameIncludes)) return false;
  if (f.hasAbility && !d.abilities.some((a) => a.name === f.hasAbility)) return false;
  if (f.not && defMatches(d, f.not)) return false;
  if (f.any && !f.any.some((g) => defMatches(d, g))) return false;
  return true;
}

export function cardMatches(env: Env, iid: number, f: Filter | undefined): boolean {
  return defMatches(def(env.ctx, iid), f);
}

// lane:metal: in-play-only filter keys `energy`, `tool`, `condition`.
const COND_BIT: Record<SpecialCondition, number> = { asleep: ASLEEP, confused: CONFUSED, paralyzed: PARALYZED, poisoned: POISONED, burned: BURNED };

export function slotMatches(env: Env, slot: Slot, f: Filter | undefined): boolean {
  if (!f) return true;
  if (f.damaged !== undefined && slot.damage > 0 !== f.damaged) return false;
  if (f.energy && !slot.energy.some((c) => cardMatches(env, c, f.energy))) return false; // lane:metal
  if (f.tool !== undefined && slot.tools.length > 0 !== f.tool) return false; // lane:metal
  if (f.condition && !(slot.cond & COND_BIT[f.condition])) return false; // lane:metal
  return defMatches(def(env.ctx, topCard(slot)), { ...f, damaged: undefined });
}

/** Slots in a zone relative to a player. */
export function slotsIn(s: GameState, p: Player, z: SlotZone): Slot[] {
  const me = s.p[p];
  const them = s.p[opp(p)];
  switch (z) {
    case 'myActive':
      return me.active ? [me.active] : [];
    case 'myBench':
      return me.bench.slice();
    case 'myPokemon':
      return allSlots(me);
    case 'oppActive':
      return them.active ? [them.active] : [];
    case 'oppBench':
      return them.bench.slice();
    case 'oppPokemon':
      return allSlots(them);
    case 'allPokemon':
      return [...allSlots(me), ...allSlots(them)];
  }
}

/** Resolve a single-Pokémon reference; null when it is not in play. */
export function resolveSlot(s: GameState, ec: EvalCtx, ref: SlotRef): Slot | null {
  if (ref === 'self') return ec.slot ? (findSlot(s, ec.slot)?.slot ?? null) : null;
  if (ref === 'defender') {
    if (ec.defender) return findSlot(s, ec.defender)?.slot ?? null;
    return s.p[opp(ec.player)].active;
  }
  if (ref === 'myActive') return s.p[ec.player].active;
  if (ref === 'oppActive') return s.p[opp(ec.player)].active;
  const v = ec.vars[ref.v];
  const id = Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined;
  if (id === undefined) return null;
  return findSlot(s, id)?.slot ?? null;
}

function zoneCards(s: GameState, p: Player, z: 'hand' | 'deck' | 'discard' | 'prizes' | 'lost'): number[] {
  return s.p[p][z];
}

export function evalExpr(env: Env, s: GameState, ec: EvalCtx, e: Expr): number {
  if (typeof e === 'number') return e;
  if ('v' in e) {
    const v = ec.vars[e.v];
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return typeof v === 'number' ? v : 0;
  }
  if ('len' in e) {
    const v = ec.vars[e.len];
    return Array.isArray(v) ? v.length : 0;
  }
  if ('count' in e) {
    const p = side(ec, e.count.who);
    return zoneCards(s, p, e.count.zone).filter((c) => cardMatches(env, c, e.count.filter)).length;
  }
  if ('pokemon' in e) {
    return slotsIn(s, ec.player, e.pokemon.zone).filter((sl) => slotMatches(env, sl, e.pokemon.filter)).length;
  }
  if ('prizesLeft' in e) return s.p[side(ec, e.prizesLeft)].prizes.length;
  if ('prizesTaken' in e) return s.p[side(ec, e.prizesTaken)].prizesTaken;
  if ('energyOn' in e) {
    const sl = resolveSlot(s, ec, e.energyOn);
    if (!sl) return 0;
    let n = 0;
    for (const c of sl.energy) {
      const d = def(env.ctx, c);
      n += e.type ? d.provides.filter((t) => t === e.type).length : Math.max(1, d.provides.length);
    }
    return n;
  }
  if ('countersOn' in e) {
    const sl = resolveSlot(s, ec, e.countersOn);
    return sl ? sl.damage / 10 : 0;
  }
  if ('handSize' in e) return s.p[side(ec, e.handSize)].hand.length;
  if ('deckSize' in e) return s.p[side(ec, e.deckSize)].deck.length;
  if ('add' in e) return e.add.reduce((a: number, x: Expr) => a + evalExpr(env, s, ec, x), 0);
  if ('sub' in e) return evalExpr(env, s, ec, e.sub[0]) - evalExpr(env, s, ec, e.sub[1]);
  if ('mul' in e) return evalExpr(env, s, ec, e.mul[0]) * evalExpr(env, s, ec, e.mul[1]);
  if ('min' in e) return Math.min(...e.min.map((x) => evalExpr(env, s, ec, x)));
  if ('max' in e) return Math.max(...e.max.map((x) => evalExpr(env, s, ec, x)));
  if ('cond' in e) return evalCond(env, s, ec, e.cond) ? evalExpr(env, s, ec, e.then) : evalExpr(env, s, ec, e.else);
  throw new Error(`unknown expr ${JSON.stringify(e)}`);
}

export function evalCond(env: Env, s: GameState, ec: EvalCtx, c: Cond): boolean {
  if ('gte' in c) return evalExpr(env, s, ec, c.gte[0]) >= evalExpr(env, s, ec, c.gte[1]);
  if ('gt' in c) return evalExpr(env, s, ec, c.gt[0]) > evalExpr(env, s, ec, c.gt[1]);
  if ('lte' in c) return evalExpr(env, s, ec, c.lte[0]) <= evalExpr(env, s, ec, c.lte[1]);
  if ('lt' in c) return evalExpr(env, s, ec, c.lt[0]) < evalExpr(env, s, ec, c.lt[1]);
  if ('eq' in c) return evalExpr(env, s, ec, c.eq[0]) === evalExpr(env, s, ec, c.eq[1]);
  if ('and' in c) return c.and.every((x) => evalCond(env, s, ec, x));
  if ('or' in c) return c.or.some((x) => evalCond(env, s, ec, x));
  if ('not' in c) return !evalCond(env, s, ec, c.not);
  if ('cardIs' in c) {
    const v = ec.vars[c.cardIs.v];
    const cards = Array.isArray(v) ? v : typeof v === 'number' ? [v] : [];
    return cards.length > 0 && cards.every((x) => cardMatches(env, x, c.cardIs.filter));
  }
  if ('slotIs' in c) {
    const sl = resolveSlot(s, ec, c.slotIs.ref);
    return !!sl && slotMatches(env, sl, c.slotIs.filter);
  }
  if ('inActive' in c) {
    const sl = resolveSlot(s, ec, c.inActive);
    return !!sl && (s.p[0].active === sl || s.p[1].active === sl);
  }
  if ('onBench' in c) {
    const sl = resolveSlot(s, ec, c.onBench);
    return !!sl && (s.p[0].bench.includes(sl) || s.p[1].bench.includes(sl));
  }
  if ('koLastTurn' in c) {
    const p = side(ec, c.koLastTurn);
    return s.p[p].lastKoTurn === s.turn - 1 || s.p[p].prevKoTurn === s.turn - 1; // lane:misc — prevKoTurn
  }
  if ('stadium' in c) {
    if (!s.stadium) return false;
    return c.stadium === true || defMatches(def(env.ctx, s.stadium.card), c.stadium);
  }
  if ('benchFull' in c) {
    const p = side(ec, c.benchFull);
    return s.p[p].bench.length >= 5;
  }
  if ('firstTurn' in c) return s.turn === 1;
  throw new Error(`unknown cond ${JSON.stringify(c)}`);
}
