/**
 * Values that change with what is in play are COMPUTED when asked, never
 * written onto a card: HP, Retreat Cost, attack cost, Weakness, prevention,
 * locks. Removing a Stadium or Tool therefore needs no undo logic.
 *
 * A static effect has a source (a Pokémon's Ability, a Tool, an attached
 * Energy, the Stadium, or a timed effect) and a scope relative to the source's
 * controller. `statics()` gathers every live one; the queries filter it.
 */
import { def, type Env } from './context.js';
import type { Filter, PType, Scope, StaticEffect } from './dsl.js';
import { defMatches, evalCond, evalExpr, slotMatches, type EvalCtx } from './eval.js';
import { allSlots, findSlot, opp, topCard } from './state.js';
import type { GameState, Player, Slot } from './types.js';

export interface LiveStatic {
  effect: StaticEffect;
  scope: Scope;
  filter?: Filter;
  when?: import('./dsl.js').Cond;
  /** Controller of the source. */
  player: Player;
  /** Source slot id (the Pokémon with the Ability / holding the Tool or Energy), 0 for Stadium/player effects. */
  slot: number;
  /** For timed effects bound to one Pokémon: that slot id. */
  bound: number;
  src: number;
  kind: 'ability' | 'tool' | 'energy' | 'stadium' | 'timed';
}

/** Gather every live static. Ability statics of Pokémon under a no-Abilities effect are dropped. */
export function statics(env: Env, s: GameState): LiveStatic[] {
  const out: LiveStatic[] = [];
  const ctx = env.ctx;
  // Non-ability sources first; they decide which Abilities are switched off.
  if (s.stadium) {
    const d = def(ctx, s.stadium.card);
    for (const st of d.statics) out.push({ ...st, player: s.stadium.owner, slot: 0, bound: 0, src: s.stadium.card, kind: 'stadium' });
  }
  const toolsOff = toolsDisabled(env, s); // lane:fighting
  for (const p of [0, 1] as Player[]) {
    for (const sl of allSlots(s.p[p])) {
      for (const t of toolsOff ? [] : sl.tools) {
        for (const st of def(ctx, t).statics) out.push({ ...st, player: p, slot: sl.id, bound: 0, src: t, kind: 'tool' });
      }
      for (const e of sl.energy) {
        for (const st of def(ctx, e).statics) out.push({ ...st, player: p, slot: sl.id, bound: 0, src: e, kind: 'energy' });
      }
    }
  }
  for (const te of s.effects) {
    if (te.until < s.turn) continue;
    out.push({
      effect: te.static,
      scope: te.slot > 0 ? 'self' : (te.scope ?? 'me'), // lane:metal: te.scope
      filter: te.filter,
      player: te.slot > 0 ? (findSlot(s, te.slot)?.owner ?? te.player) : te.player,
      slot: te.slot,
      bound: te.slot,
      src: te.src,
      kind: 'timed',
    });
  }
  const pre = out.length;
  for (const p of [0, 1] as Player[]) {
    for (const sl of allSlots(s.p[p])) {
      const d = def(ctx, topCard(sl));
      if (d.coverage !== 'full') continue;
      for (const ab of d.abilities) {
        for (const st of ab.script?.statics ?? []) {
          out.push({ ...st, player: p, slot: sl.id, bound: 0, src: topCard(sl), kind: 'ability' });
        }
      }
    }
  }
  // Drop Ability statics from Pokémon that have no Abilities right now.
  const locks = out.filter((x) => x.effect.k === 'noAbilities' && live(env, s, x));
  if (!locks.length) return out.filter((x, i) => i < pre || live(env, s, x));
  return out.filter((x, i) => {
    if (i < pre) return true;
    const sl = findSlot(s, x.slot);
    if (sl && locks.some((l) => l !== x && affectsSlot(env, s, l, sl.slot, sl.owner))) return false;
    return live(env, s, x);
  });
}

function live(env: Env, s: GameState, x: LiveStatic): boolean {
  if (x.kind === 'timed') return true;
  // `when` conditions are evaluated from the source's point of view.
  if (!x.when) return true;
  const ec: EvalCtx = { player: x.player, slot: x.slot, vars: {} };
  return evalCond(env, s, ec, x.when);
}

/** Does this static apply to this Pokémon (owned by `owner`)? */
export function affectsSlot(env: Env, s: GameState, x: LiveStatic, slot: Slot, owner: Player): boolean {
  const mine = owner === x.player;
  const isActive = s.p[owner].active === slot;
  let ok: boolean;
  switch (x.scope) {
    case 'self':
      ok = (x.bound || x.slot) === slot.id;
      break;
    case 'myActive':
      ok = mine && isActive;
      break;
    case 'myBench':
      ok = mine && !isActive;
      break;
    case 'myPokemon':
      ok = mine;
      break;
    case 'oppActive':
      ok = !mine && isActive;
      break;
    case 'oppBench':
      ok = !mine && !isActive;
      break;
    case 'oppPokemon':
      ok = !mine;
      break;
    case 'allPokemon':
      ok = true;
      break;
    default:
      ok = false;
  }
  return ok && slotMatches(env, slot, x.filter);
}

export function affectsPlayer(x: LiveStatic, p: Player): boolean {
  if (x.scope === 'both') return true;
  if (x.scope === 'me') return x.player === p;
  if (x.scope === 'opp') return x.player !== p;
  return false;
}

function onSlot(env: Env, s: GameState, all: LiveStatic[], slot: Slot, k: StaticEffect['k']): LiveStatic[] {
  const owner = s.p[0].active === slot || s.p[0].bench.includes(slot) ? 0 : 1;
  return all.filter((x) => x.effect.k === k && affectsSlot(env, s, x, slot, owner as Player));
}

export function ownerOf(s: GameState, slot: Slot): Player {
  return s.p[0].active === slot || s.p[0].bench.includes(slot) ? 0 : 1;
}

export function maxHp(env: Env, s: GameState, slot: Slot, all = statics(env, s)): number {
  let hp = def(env.ctx, topCard(slot)).hp;
  for (const x of onSlot(env, s, all, slot, 'hp')) hp += (x.effect as { delta: number }).delta;
  return Math.max(10, hp);
}

export function retreatCost(env: Env, s: GameState, slot: Slot, all = statics(env, s)): number {
  let cost = def(env.ctx, topCard(slot)).retreat;
  let set: number | null = null;
  for (const x of onSlot(env, s, all, slot, 'retreatCost')) {
    const e = x.effect as { delta?: number; set?: number };
    if (e.set !== undefined) set = set === null ? e.set : Math.min(set, e.set);
    if (e.delta !== undefined) cost += e.delta;
  }
  if (set !== null) cost = Math.min(cost, set);
  return Math.max(0, cost);
}

export function attackCost(env: Env, s: GameState, slot: Slot, idx: number, all = statics(env, s)): PType[] {
  const d = def(env.ctx, topCard(slot));
  const atk = d.attacks[idx];
  if (!atk) return [];
  let cost = atk.cost.slice();
  for (const x of onSlot(env, s, all, slot, 'attackCostSet')) {
    const e = x.effect as { attack: string; cost: PType[] };
    if (e.attack === atk.name) cost = e.cost.slice();
  }
  for (const x of onSlot(env, s, all, slot, 'attackCostC')) {
    const e = x.effect as { delta: import('./dsl.js').Expr; attack?: string };
    if (e.attack && e.attack !== atk.name) continue;
    const delta = evalExpr(env, s, { player: x.player, slot: x.slot, vars: {} }, e.delta);
    if (delta < 0) {
      for (let i = 0; i < -delta; i++) {
        const j = cost.lastIndexOf('Colorless');
        if (j < 0) break;
        cost.splice(j, 1);
      }
    } else for (let i = 0; i < delta; i++) cost.push('Colorless');
  }
  return cost;
}

/** One Energy unit: a type, or 'Any' for "provides every type of Energy" (Legacy Energy). */ // lane:fighting
export type EnergyUnit = PType | 'Any'; // lane:fighting

/** Energy units a Pokémon has: one entry per unit, each a type (Colorless = only Colorless). */
export function energyUnits(env: Env, slot: Slot): EnergyUnit[] {
  const out: EnergyUnit[] = [];
  for (const c of slot.energy) {
    const d = def(env.ctx, c);
    // lane:fighting — "provides every type of Energy but provides only n Energy at a time"
    const any = d.script?.providesAny;
    if (any && (!any.when || slotMatches(env, slot, any.when))) {
      for (let i = 0; i < any.n; i++) out.push('Any');
      continue;
    }
    const p = providesOn(env, slot, c); // lane:misc
    if (p.length) out.push(...p);
    else out.push('Colorless');
  }
  return out;
}

/** lane:misc — the Energy an attached card provides on this Pokémon (CardScript.providesIf, e.g. Ignition Energy). */
export function providesOn(env: Env, slot: Slot, card: number): PType[] {
  const d = def(env.ctx, card);
  const alt = d.coverage === 'full' ? d.script?.providesIf : undefined;
  if (alt && slotMatches(env, slot, alt.filter)) return alt.provides;
  return d.provides;
}

/** Can these units pay this cost? Typed requirements first (exact type, then an 'Any' unit), Colorless from anything left. */
export function canPay(cost: readonly PType[], units: readonly EnergyUnit[]): boolean {
  if (cost.length > units.length) return false;
  const pool = units.slice();
  for (const t of cost) {
    if (t === 'Colorless') continue;
    let i = pool.indexOf(t);
    if (i < 0) i = pool.indexOf('Any'); // lane:fighting
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  const colorless = cost.filter((t) => t === 'Colorless').length;
  return pool.length >= colorless;
}

export function weaknessOf(env: Env, s: GameState, slot: Slot, all = statics(env, s)): PType | null {
  const over = onSlot(env, s, all, slot, 'weaknessType');
  if (over.length) return (over[over.length - 1]!.effect as { type: PType }).type;
  return def(env.ctx, topCard(slot)).weakness;
}

/** Are effects from `fromPlayer`'s attack/Ability on this Pokémon prevented? */
export function effectsPrevented(
  env: Env,
  s: GameState,
  slot: Slot,
  fromPlayer: Player,
  kind: 'attack' | 'ability',
  all = statics(env, s),
): boolean {
  if (ownerOf(s, slot) === fromPlayer) return false;
  for (const x of onSlot(env, s, all, slot, 'preventEffects')) {
    if ((x.effect as { from: string[] }).from.includes(kind)) return true;
  }
  if (kind === 'attack') {
    for (const x of onSlot(env, s, all, slot, 'preventDamage')) {
      if ((x.effect as { andEffects?: boolean }).andEffects) return true;
    }
  }
  return false;
}

/** lane:darkrai — are damage counters placed on this Pokémon by `fromPlayer`'s attack/Ability effects prevented (Battle Cage)? */
export function countersPrevented(
  env: Env,
  s: GameState,
  slot: Slot,
  fromPlayer: Player,
  kind: 'attack' | 'ability',
  all = statics(env, s),
): boolean {
  if (ownerOf(s, slot) === fromPlayer) return false;
  return onSlot(env, s, all, slot, 'preventCounters').some((x) => (x.effect as { from: string[] }).from.includes(kind));
}

/** Is damage from `fromPlayer`'s attack to this Pokémon prevented? */
export function damagePrevented(
  env: Env,
  s: GameState,
  slot: Slot,
  fromPlayer: Player,
  all = statics(env, s),
  /** lane:ghost — the attacking Pokémon, for prevention that depends on it (Ancient Bulwark). */
  attacker?: Slot,
): boolean {
  const owner = ownerOf(s, slot);
  // Tera rule: while on the Bench, prevent all damage done to it by attacks (both players').
  if (def(env.ctx, topCard(slot)).tera && s.p[owner].active !== slot) return true;
  if (owner === fromPlayer) return false;
  return onSlot(env, s, all, slot, 'preventDamage').some((x) => {
    // lane:ghost — "attacks from your opponent's Pokémon that have 2 or less Energy attached" (Energy units, as energyOn counts).
    const max = (x.effect as { attackerMaxEnergy?: number }).attackerMaxEnergy;
    if (max === undefined) return true;
    return !!attacker && energyUnits(env, attacker).length <= max;
  });
}

export function damageOut(env: Env, s: GameState, attacker: Slot, target: Slot, all = statics(env, s)): number {
  let n = 0;
  for (const x of onSlot(env, s, all, attacker, 'damageOut')) {
    const e = x.effect as { amount: number; vs?: Filter };
    if (e.vs && !slotMatches(env, target, e.vs)) continue;
    n += e.amount;
  }
  return n;
}

/** `fromPlayer`: whose attack it is (lane:metal) — a `fromOpp` reduction skips the target owner's own attacks. */
export function damageIn(env: Env, s: GameState, target: Slot, all = statics(env, s), fromPlayer?: Player): number {
  let n = 0;
  for (const x of onSlot(env, s, all, target, 'damageIn')) {
    const e = x.effect as { amount: number; fromOpp?: boolean };
    if (e.fromOpp && fromPlayer !== undefined && fromPlayer === ownerOf(s, target)) continue; // lane:metal
    n += e.amount;
  }
  return n;
}

export function hasNoAbilities(env: Env, s: GameState, slot: Slot, all = statics(env, s)): boolean {
  return onSlot(env, s, all, slot, 'noAbilities').some((x) => x.slot !== slot.id);
}

/** lane:misc — Damp: "this Pokémon is Knocked Out" Abilities are lost while a loseSelfKoAbilities effect applies. */
export const SELF_KO_TEXT = /this Pokémon is Knocked Out/i;
export function abilityLost(
  env: Env,
  s: GameState,
  slot: Slot,
  ab: { text: string; script?: { selfKo?: boolean } },
  all = statics(env, s),
): boolean {
  const selfKo = ab.script?.selfKo ?? SELF_KO_TEXT.test(ab.text);
  return selfKo && onSlot(env, s, all, slot, 'loseSelfKoAbilities').length > 0;
}

/** lane:misc — Wonder Kiss: the extra-Prize effect that applies to a taker (at most one: it doesn't stack). */
export function extraPrizeFor(_env: Env, _s: GameState, p: Player, all: LiveStatic[]): LiveStatic | undefined {
  return all.find((x) => x.effect.k === 'extraPrize' && affectsPlayer(x, p));
}

export function cantAttack(env: Env, s: GameState, slot: Slot, all = statics(env, s)): boolean {
  return onSlot(env, s, all, slot, 'cantAttack').length > 0;
}

export function cantRetreat(env: Env, s: GameState, slot: Slot, all = statics(env, s)): boolean {
  if (def(env.ctx, topCard(slot)).script?.fix?.playAsBasic?.cantRetreat) return true; // lane:ghost (Antique fossils)
  return onSlot(env, s, all, slot, 'cantRetreat').length > 0;
}

/** "This Pokémon can't use <attack>" (Mega Brave, Accelerating Stab). */ // lane:fighting
export function attackBlocked(env: Env, s: GameState, slot: Slot, attack: string, all = statics(env, s)): boolean {
  return onSlot(env, s, all, slot, 'cantUseAttack').some((x) => (x.effect as { attack: string }).attack === attack);
}

/** Jamming Tower: while the Stadium in play says so, Pokémon Tools have no effect (no statics, no triggers). */ // lane:fighting
export function toolsDisabled(env: Env, s: GameState): boolean {
  return !!s.stadium && def(env.ctx, s.stadium.card).statics.some((x) => x.effect.k === 'noToolEffects');
}

/** lane:ghost — Watchful Eye: are damage counters on `p`'s Pokémon fixed in place? */
export function countersFixed(env: Env, s: GameState, p: Player, all = statics(env, s)): boolean {
  return all.some((x) => x.effect.k === 'countersFixed' && affectsPlayer(x, p));
}

export function itemLocked(env: Env, s: GameState, p: Player, all = statics(env, s)): boolean {
  return all.some((x) => x.effect.k === 'itemLock' && affectsPlayer(x, p));
}

export function benchLimit(_env: Env, _s: GameState, _p: Player): number {
  return 5;
}

/** Defs of a player's Pokémon in play, for filters like "if you have X in play". */
export function inPlayDefs(env: Env, s: GameState, p: Player) {
  return allSlots(s.p[p]).map((sl) => def(env.ctx, topCard(sl)));
}

export { defMatches, opp };
