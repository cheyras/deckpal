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
import type { Filter, PlayLock, PType, Scope, SpecialCondition, StaticEffect } from './dsl.js';
import { cardMatches, defMatches, evalCond, evalExpr, providesOn, pushUnits, slotMatches, unitFits, type EnergyUnit, type EvalCtx } from './eval.js';
import { allSlots, findSlot, opp, topCard } from './state.js';
import type { AttackDef, CardDef, GameState, Player, Slot } from './types.js';

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
  kind: 'ability' | 'tool' | 'energy' | 'stadium' | 'timed' | 'card';
  /** Timed effects: the turn it was created in. */
  since?: number;
  /** Timed effects set by an attack that name it (`extraPrize` `thisAttack`): the attacker's slot and the turn's attack number. */
  atk?: { by: number; use: number };
}

/** Which static sources any card in this game has at all, decided once per game from the card definitions. */
interface Sources {
  card: boolean;
  ability: boolean;
}
const sourcesOf = new WeakMap<object, Sources>();
const kindsOf = new WeakMap<object, Set<string>>();
/** Every static effect kind any card in this game carries (card, Ability, Tool, Energy or Stadium), decided once per game. */
function kindsIn(ctx: Env['ctx']): Set<string> {
  let r = kindsOf.get(ctx);
  if (!r) {
    r = new Set();
    for (const d of ctx.defs) {
      for (const st of d.statics) r.add(st.effect.k);
      for (const st of d.script?.statics ?? []) r.add(st.effect.k);
      for (const ab of d.abilities) for (const st of ab.script?.statics ?? []) r.add(st.effect.k);
    }
    kindsOf.set(ctx, r);
  }
  return r;
}
function sources(ctx: Env['ctx']): Sources {
  let r = sourcesOf.get(ctx);
  if (!r) {
    r = { card: false, ability: false };
    for (const d of ctx.defs) {
      if (d.coverage !== 'full') continue;
      if (d.kind === 'pokemon' && d.script?.statics?.length) r.card = true;
      if (d.abilities.some((ab) => ab.script?.statics?.length)) r.ability = true;
    }
    sourcesOf.set(ctx, r);
  }
  return r;
}

let resolving = 0;
/** True while `statics` is gathering (and filtering by Ability locks): Ability-given types are not applied then — see `slotTypes`. */
export function staticsResolving(): boolean {
  return resolving > 0;
}

/** Gather every live static. Ability statics of Pokémon under a no-Abilities effect are dropped. */
export function statics(env: Env, s: GameState): LiveStatic[] {
  resolving++;
  try {
    return gatherStatics(env, s);
  } finally {
    resolving--;
  }
}

function gatherStatics(env: Env, s: GameState): LiveStatic[] {
  const out: LiveStatic[] = [];
  const ctx = env.ctx;
  // Non-ability sources first; they decide which Abilities are switched off.
  if (s.stadium) {
    const d = def(ctx, s.stadium.card);
    for (const st of d.statics) out.push({ ...st, player: s.stadium.owner, slot: 0, bound: 0, src: s.stadium.card, kind: 'stadium' });
  }
  const both: [Slot[], Slot[]] = [allSlots(s.p[0]), allSlots(s.p[1])]; // the Pokémon in play, gathered once for the passes below
  const toolsOff = toolsDisabled(env, s); // lane:fighting
  for (const p of [0, 1] as Player[]) {
    for (const sl of both[p]) {
      for (const t of toolsOff ? [] : sl.tools) {
        for (const st of def(ctx, t).statics) out.push({ ...st, player: p, slot: sl.id, bound: 0, src: t, kind: 'tool' });
      }
      for (const e of sl.energy) {
        for (const st of def(ctx, e).statics) out.push({ ...st, player: p, slot: sl.id, bound: 0, src: e, kind: 'energy' });
      }
    }
  }
  // Statics printed on a Pokémon card itself (not in an Ability): never switched off by "no Abilities" effects.
  const src = sources(ctx);
  if (src.card) for (const p of [0, 1] as Player[]) {
    for (const sl of both[p]) {
      const d = def(ctx, topCard(sl));
      if (d.coverage !== 'full' || d.kind !== 'pokemon') continue;
      for (const st of d.script?.statics ?? []) out.push({ ...st, player: p, slot: sl.id, bound: 0, src: topCard(sl), kind: 'card' });
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
      since: te.since,
      ...(te.atk ? { atk: te.atk } : {}),
    });
  }
  const pre = out.length;
  if (src.ability) for (const p of [0, 1] as Player[]) {
    for (const sl of both[p]) {
      const d = def(ctx, topCard(sl));
      if (d.coverage !== 'full') continue;
      for (const ab of d.abilities) {
        for (const st of ab.script?.statics ?? []) {
          out.push({ ...st, player: p, slot: sl.id, bound: 0, src: topCard(sl), kind: 'ability' });
        }
      }
    }
  }
  // Every source's `when` holds right now (a Tool's, an Energy's or a Stadium's as much as an Ability's:
  // Shadowy Darkness Energy protects only on the Bench). Then drop Ability statics from Pokémon that
  // have no Abilities right now.
  const locks = out.filter((x) => x.effect.k === 'noAbilities' && live(env, s, x));
  if (!locks.length) return out.filter((x) => live(env, s, x));
  return out.filter((x, i) => {
    if (i < pre) return live(env, s, x);
    const sl = findSlot(s, x.slot);
    if (sl && locks.some((l) => l !== x && affectsSlot(env, s, l, sl.slot, sl.owner) && lockBites(env, s, out, l, sl.slot, sl.owner))) return false;
    return live(env, s, x);
  });
}

/**
 * Does a "no Abilities" effect take the Abilities of this Pokémon away? Not when the lock is an Ability of the other player's
 * Pokémon and this Pokémon has an Ability that prevents the effects of Abilities done to it: "Luminous Wing takes precedence
 * over Initialization. It doesn't matter which one comes into play first" (TPCi Rules Team 2026-03-26, ruling 2309).
 */
function lockBites(env: Env, s: GameState, all: LiveStatic[], lock: LiveStatic, slot: Slot, owner: Player): boolean {
  if (lock.kind !== 'ability' || lock.player === owner) return true;
  return !all.some(
    (y) =>
      y.kind === 'ability' &&
      y.effect.k === 'preventEffects' &&
      y.effect.from.includes('ability') &&
      affectsSlot(env, s, y, slot, owner) &&
      live(env, s, y),
  );
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
  return ok && slotMatches(env, slot, x.filter, true, s);
}

export function affectsPlayer(x: LiveStatic, p: Player): boolean {
  if (x.scope === 'both') return true;
  if (x.scope === 'me') return x.player === p;
  if (x.scope === 'opp') return x.player !== p;
  return false;
}

const NONE: LiveStatic[] = []; // shared: callers only read the result

function onSlot(env: Env, s: GameState, all: LiveStatic[], slot: Slot, k: StaticEffect['k']): LiveStatic[] {
  // Most queries ask for a kind nothing in play has: find the first of the kind before working out whose Pokémon this is.
  let i = 0;
  while (i < all.length && (all[i] as LiveStatic).effect.k !== k) i++;
  if (i === all.length) return NONE;
  const owner = (s.p[0].active === slot || s.p[0].bench.includes(slot) ? 0 : 1) as Player;
  const out: LiveStatic[] = [];
  for (; i < all.length; i++) {
    const x = all[i] as LiveStatic;
    if (x.effect.k === k && affectsSlot(env, s, x, slot, owner)) out.push(x);
  }
  return out;
}

/** lane:zoroark — the live `surviveKoAtFullHp` effects on a Pokémon (Survival Brace). */
export function surviveKoSources(env: Env, s: GameState, slot: Slot, all = statics(env, s)): LiveStatic[] {
  return onSlot(env, s, all, slot, 'surviveKoAtFullHp');
}

export function ownerOf(s: GameState, slot: Slot): Player {
  return s.p[0].active === slot || s.p[0].bench.includes(slot) ? 0 : 1;
}

export function maxHp(env: Env, s: GameState, slot: Slot, all = statics(env, s)): number {
  let hp = def(env.ctx, topCard(slot)).hp;
  const once = new Set<string>(); // noStack keys already counted
  for (const x of onSlot(env, s, all, slot, 'hp')) {
    const e = x.effect as { delta: number; noStack?: string };
    if (e.noStack) {
      if (once.has(e.noStack)) continue;
      once.add(e.noStack);
    }
    hp += e.delta;
  }
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

/** One attack the active Pokémon can use: a printed one (`card` unset) or one printed on an attached Tool that grants it (`card` = that Tool). */
export interface AttackOption {
  idx: number;
  card?: number;
  /** The card the attack is printed on (the Pokémon's top card, or the Tool). */
  d: CardDef;
  atk: AttackDef;
}

/** The attacks a Pokémon can use: its printed ones, then those of attached Tools that grant them (`grantsAttacks`). */
export function attackOptions(env: Env, s: GameState, slot: Slot, all = statics(env, s)): AttackOption[] {
  const d = def(env.ctx, topCard(slot));
  const out: AttackOption[] = d.attacks.map((atk, idx) => ({ idx, d, atk }));
  for (const x of onSlot(env, s, all, slot, 'grantsAttacks')) {
    if (x.kind !== 'tool') continue;
    const td = def(env.ctx, x.src);
    td.attacks.forEach((atk, idx) => out.push({ idx, card: x.src, d: td, atk }));
  }
  // Memory Dive: an evolved Pokémon can use any attack of the cards beneath its top card (its Basic and Stage 1 cards).
  if (slot.cards.length > 1 && onSlot(env, s, all, slot, 'previousAttacks').length) {
    for (const c of slot.cards.slice(0, -1)) {
      const pd = def(env.ctx, c);
      pd.attacks.forEach((atk, idx) => out.push({ idx, card: c, d: pd, atk }));
    }
  }
  // Memory Helix: the attacks of any of the owner's Benched Pokémon, as this Pokémon's own (once for each distinct attack).
  if (staticMayExist(env, s, 'borrowAttacks') && onSlot(env, s, all, slot, 'borrowAttacks').length) {
    const seen = new Set(out.map((o) => `${o.d.idx}:${o.atk.name}`));
    for (const b of s.p[ownerOf(s, slot)].bench) {
      if (b === slot) continue;
      const bc = topCard(b);
      const bd = def(env.ctx, bc);
      bd.attacks.forEach((atk, idx) => {
        const key = `${bd.idx}:${atk.name}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ idx, card: bc, d: bd, atk });
      });
    }
  }
  return out;
}

/**
 * An attack's cost after the effects that set or change it, and how many requirements of any type the player may leave out
 * (`attackCostLess`). `card`: the attack is printed on that attached Tool (see `attackOptions`).
 */
export function attackCostParts(env: Env, s: GameState, slot: Slot, idx: number, all = statics(env, s), card?: number): { cost: PType[]; waive: number } {
  const d = def(env.ctx, card ?? topCard(slot));
  const atk = d.attacks[idx];
  if (!atk) return { cost: [], waive: 0 };
  let cost = atk.cost.slice();
  let waive = 0;
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
  for (const x of onSlot(env, s, all, slot, 'attackCostLess')) {
    const e = x.effect as { n: number; attack?: string };
    if (e.attack && e.attack !== atk.name) continue;
    waive += e.n;
  }
  return { cost, waive: Math.min(waive, cost.length) };
}

/**
 * The Energy an attack needs, with "costs N Energy less (of any type)" taken off: {C} first, then the last typed requirement. An
 * estimate for heuristics when the reduction is not all {C}; whether a Pokémon can really pay is `canPayAttack`.
 */
export function attackCost(env: Env, s: GameState, slot: Slot, idx: number, all = statics(env, s), card?: number): PType[] {
  const { cost, waive } = attackCostParts(env, s, slot, idx, all, card);
  for (let i = 0; i < waive; i++) {
    const j = cost.lastIndexOf('Colorless');
    cost.splice(j >= 0 ? j : cost.length - 1, 1);
  }
  return cost;
}

/** Can the Pokémon pay this attack with the Energy it has (units), leaving out any requirements the attack's cost effects waive? */
export function canPayAttack(env: Env, s: GameState, slot: Slot, idx: number, units: readonly EnergyUnit[], all = statics(env, s), card?: number): boolean {
  const { cost, waive } = attackCostParts(env, s, slot, idx, all, card);
  return canPay(cost, units, waive);
}

/** Energy units a Pokémon has: one entry per unit, each a type (Colorless = only Colorless). */
export function energyUnits(env: Env, slot: Slot, s?: GameState, all?: LiveStatic[]): EnergyUnit[] {
  const out: EnergyUnit[] = [];
  if (s && env.ctx.energyMods) all ??= staticsForEnergy(env, s);
  for (const c of slot.energy) pushUnits(env, slot, c, out, s, all);
  return out;
}

/** The Energy units one attached card provides on this Pokémon. */
export function cardUnits(env: Env, slot: Slot, card: number, s?: GameState, all?: LiveStatic[]): EnergyUnit[] {
  const out: EnergyUnit[] = [];
  pushUnits(env, slot, card, out, s, all);
  return out;
}

let replacing = 0;
/**
 * The live statics, for counting Energy under a replacement (Wild Growth), or undefined while they are already being gathered: a
 * static whose own condition counts Energy would otherwise ask for them again without end. Then nothing is replaced.
 */
export function staticsForEnergy(env: Env, s: GameState): LiveStatic[] | undefined {
  if (replacing) return undefined;
  replacing++;
  try {
    return statics(env, s);
  } finally {
    replacing--;
  }
}

/**
 * The Energy an attached card provides in place of what it prints, when a static in play replaces it (`energyProvides`: Meganium's Wild
 * Growth), or null. The first that applies is used: two replacements don't add up.
 */
export function energyReplacement(env: Env, s: GameState, slot: Slot, card: number, all?: LiveStatic[]): PType[] | null {
  const live = all ?? staticsForEnergy(env, s);
  if (!live) return null;
  const owner = ownerOf(s, slot);
  for (const x of live) {
    if (x.effect.k !== 'energyProvides' || !affectsSlot(env, s, x, slot, owner)) continue;
    if (cardMatches(env, card, x.effect.cards)) return x.effect.provides;
  }
  return null;
}

/** Can these units pay this cost? Typed requirements first (exact type, then an 'Any' unit), Colorless from anything left. */
export function canPay(cost: readonly PType[], units: readonly EnergyUnit[], waive = 0): boolean {
  if (waive > 0) {
    if (waive >= cost.length) return true; // every requirement is left out
    // "Costs N Energy less, of any type": leave out N requirements, whichever helps. Leaving out a typed one is never worse than
    // leaving out a {C} (anything that pays the typed one pays a {C} too), so try each distinct type, then {C}.
    const tried = new Set<PType>();
    for (let i = 0; i < cost.length; i++) {
      const t = cost[i] as PType;
      if (tried.has(t)) continue;
      tried.add(t);
      if (canPay(cost.filter((_, j) => j !== i), units, waive - 1)) return true;
    }
    return false;
  }
  if (cost.length > units.length) return false;
  const pool = units.slice();
  for (const t of cost) {
    if (t === 'Colorless') continue;
    let i = pool.indexOf(t);
    if (i < 0) i = pool.findIndex((u) => u !== 'Any' && unitFits(u, t)); // a unit that is either of two types ({P}/{D})
    if (i < 0) i = pool.indexOf('Any'); // lane:fighting
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  const colorless = cost.filter((t) => t === 'Colorless').length;
  return pool.length >= colorless;
}

/** How Weakness multiplies damage to this Pokémon: ×2, or the highest `weaknessMultiplier` that applies (Illumise). */
export function weaknessMultiplier(env: Env, s: GameState, slot: Slot, all?: LiveStatic[]): number {
  let m = 2;
  if (!staticMayExist(env, s, 'weaknessMultiplier')) return m;
  for (const x of onSlot(env, s, all ?? statics(env, s), slot, 'weaknessMultiplier')) m = Math.max(m, (x.effect as { mult: number }).mult);
  return m;
}

/**
 * Can a static of this effect kind exist in this game right now? False when no card in the game has one and no timed effect carries
 * it, so a caller can skip gathering every live static (the common case for a rare effect: Quaking Fist, Life-Locked, Weakness ×3).
 */
export function staticMayExist(env: Env, s: GameState, kind: StaticEffect['k']): boolean {
  if (kindsIn(env.ctx).has(kind)) return true;
  for (const te of s.effects) if (te.static.k === kind && te.until >= s.turn) return true;
  return false;
}

/**
 * Can this Pokémon not be healed right now (Yveltal, Life-Locked)? A lock that is an opposing Pokémon's Ability does nothing to a
 * Pokémon that prevents the effects of such Abilities (Luminous Wing) while that protection is itself on.
 */
export function healLocked(env: Env, s: GameState, slot: Slot, all?: LiveStatic[]): boolean {
  if (!staticMayExist(env, s, 'noHeal')) return false;
  const live = all ?? statics(env, s);
  for (const x of onSlot(env, s, live, slot, 'noHeal')) {
    if (x.kind === 'ability' && effectsPrevented(env, s, slot, x.player, 'ability', live)) continue;
    return true;
  }
  return false;
}

/** How many coins this player flips when they try to use a Trainer card from their hand (Quaking Fist): one for each such effect. */
export function trainerCoinFlips(p: Player, all: LiveStatic[]): number {
  return all.filter((x) => x.effect.k === 'trainerCoinFlip' && affectsPlayer(x, p)).length;
}

export function weaknessOf(env: Env, s: GameState, slot: Slot, all = statics(env, s)): PType | null {
  if (onSlot(env, s, all, slot, 'noWeakness').length) return null;
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
  /** The attacking Pokémon, for prevention that depends on it; default: the one whose attack is being resolved (`attackBy`). */
  attacker?: Slot,
): boolean {
  if (ownerOf(s, slot) === fromPlayer) return false;
  for (const x of onSlot(env, s, all, slot, 'preventEffects')) {
    if ((x.effect as { from: string[] }).from.includes(kind)) return true;
  }
  if (kind === 'attack') {
    for (const x of onSlot(env, s, all, slot, 'preventDamage')) {
      const e = x.effect as { andEffects?: boolean; attacker?: Filter; ifAtMost?: number; ifAtLeast?: number };
      if (!e.andEffects || e.ifAtMost !== undefined || e.ifAtLeast !== undefined) continue; // effects are not damage: no amount to compare
      // "...effects of attacks from your opponent's Tera Pokémon": only an attack by a Pokémon that matches.
      if (!e.attacker || (attacker ? attackerMatches(env, s, attacker, e.attacker, all) : attackIsFrom(env, s, e.attacker, all))) return true;
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

/**
 * Does an attacking Pokémon match an `attacker` filter? `anyAbility` also needs its Abilities to be on right now (ruling 2260:
 * Team Rocket's Watchtower says {C} Pokémon have no Abilities, so they are not "Pokémon that have an Ability").
 */
export function attackerMatches(env: Env, s: GameState, attacker: Slot, f: Filter, all = statics(env, s)): boolean {
  if (!slotMatches(env, attacker, f, true, s)) return false;
  return !f.anyAbility || !hasNoAbilities(env, s, attacker, all);
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
  /** The damage about to be done, after Weakness, Resistance and the effects on damage taken: for "if that damage is N or less / more". */
  amount?: number,
): boolean {
  const owner = ownerOf(s, slot);
  // Tera rule: while on the Bench, prevent all damage done to it by attacks (both players').
  if (def(env.ctx, topCard(slot)).tera && s.p[owner].active !== slot) return true;
  if (owner === fromPlayer) return false;
  return onSlot(env, s, all, slot, 'preventDamage').some((x) => {
    // lane:ghost — "attacks from your opponent's Pokémon that have 2 or less Energy attached" (Energy units, as energyOn counts).
    const e = x.effect as { attackerMaxEnergy?: number; attacker?: Filter; ifAtMost?: number; ifAtLeast?: number };
    // "attacks from Basic Pokémon": only an attacking Pokémon that matches the filter.
    if (e.attacker && !(attacker && attackerMatches(env, s, attacker, e.attacker, all))) return false;
    // "if that damage is 60 or less" / "200 or more": the damage as it stands (ruling 2197: after Weakness and Resistance).
    if (e.ifAtMost !== undefined && !(amount !== undefined && amount > 0 && amount <= e.ifAtMost)) return false;
    if (e.ifAtLeast !== undefined && !(amount !== undefined && amount >= e.ifAtLeast)) return false;
    const max = e.attackerMaxEnergy;
    if (max === undefined) return true;
    return !!attacker && energyUnits(env, attacker, s, all).length <= max;
  });
}

export function damageOut(env: Env, s: GameState, attacker: Slot, target: Slot, all = statics(env, s)): number {
  let n = 0;
  const once = new Set<string>(); // lane:trevenant — noStack keys already counted
  for (const x of onSlot(env, s, all, attacker, 'damageOut')) {
    const e = x.effect as { amount: number; vs?: Filter; noStack?: string };
    if (e.vs && !slotMatches(env, target, e.vs, true, s)) continue;
    if (e.noStack) {
      if (once.has(e.noStack)) continue;
      once.add(e.noStack);
    }
    n += e.amount;
  }
  return n;
}

/** `fromPlayer`: whose attack it is (lane:metal) — a `fromOpp` reduction skips the target owner's own attacks. */
export function damageIn(
  env: Env,
  s: GameState,
  target: Slot,
  all = statics(env, s),
  fromPlayer?: Player,
  attacker?: Slot,
  /** Out: the cards (Tools) whose reducing effect applied, for the `damageReduced` trigger. */
  reducers?: number[],
): number {
  let n = 0;
  const once = new Set<string>(); // noStack keys already counted
  for (const x of onSlot(env, s, all, target, 'damageIn')) {
    const e = x.effect as { amount: number; fromOpp?: boolean; attacker?: Filter; noStack?: string };
    if (e.attacker && !(attacker && attackerMatches(env, s, attacker, e.attacker, all))) continue;
    if (e.fromOpp && fromPlayer !== undefined && fromPlayer === ownerOf(s, target)) continue; // lane:metal
    if (e.noStack) {
      if (once.has(e.noStack)) continue;
      once.add(e.noStack);
    }
    n += e.amount;
    if (reducers && e.amount < 0 && x.kind === 'tool') reducers.push(x.src);
  }
  return n;
}

export function hasNoAbilities(env: Env, s: GameState, slot: Slot, all?: LiveStatic[]): boolean {
  // Working out who is locked reads the locks' filters, which may ask for a type, which an Ability may give, which asks whether the
  // Abilities are on: the loop is broken here as in `statics` — Ability-given types are not applied (see `slotTypes`).
  resolving++;
  try {
    const live = all ?? statics(env, s);
    const owner = ownerOf(s, slot);
    return onSlot(env, s, live, slot, 'noAbilities').some((x) => x.slot !== slot.id && lockBites(env, s, live, x, slot, owner));
  } finally {
    resolving--;
  }
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

/** The extra-Prize effects (Wonder Kiss, Anthea & Concordia) that apply to a taker. */
export function extraPrizeEffects(p: Player, all: LiveStatic[]): LiveStatic[] {
  return all.filter((x) => x.effect.k === 'extraPrize' && affectsPlayer(x, p));
}

/**
 * Does the attack being resolved come from a Pokémon matching `f`? The Pokémon that used it, if still in play, else the card it
 * was. With no filter: always. False when no attack is being resolved.
 */
export function attackIsFrom(env: Env, s: GameState, f: Filter | undefined, all = statics(env, s)): boolean {
  if (!f) return true;
  if (s.attackBy === undefined) return false;
  const loc = findSlot(s, s.attackBy);
  if (loc) return attackerMatches(env, s, loc.slot, f, all);
  return s.attackByCard !== undefined && cardMatches(env, s.attackByCard, f);
}

/**
 * Prize cards a Knock Out by damage from the current attack changes by, for a Pokémon (`koPrizes` statics on it): the sum of
 * the deltas, each `noStack` key counted once; `none` means no Prize cards at all.
 */
export function koPrizeEffects(
  env: Env,
  s: GameState,
  slot: Slot,
  all = statics(env, s),
  /** The Pokémon is being Knocked Out by damage from an attack (the effects without `anyKo` need that). */
  byAttack = true,
): { delta: number; none: boolean } {
  let delta = 0;
  let none = false;
  const once = new Set<string>();
  const owner = ownerOf(s, slot);
  for (const x of onSlot(env, s, all, slot, 'koPrizes')) {
    const e = x.effect as { delta?: number; none?: boolean; attacker?: Filter; noStack?: string; anyKo?: boolean; duringTakersTurn?: boolean };
    if (!e.anyKo && !byAttack) continue;
    // "During your next turn": only while the player who takes the Prize cards is the one whose turn it is, and not the turn in which
    // the effect was made (that is the turn before "your next turn").
    if (e.duringTakersTurn && (s.current === owner || (x.since ?? -1) >= s.turn)) continue;
    if (!e.anyKo && !attackIsFrom(env, s, e.attacker, all)) continue;
    if (e.noStack) {
      if (once.has(e.noStack)) continue;
      once.add(e.noStack);
    }
    if (e.none) none = true;
    delta += e.delta ?? 0;
  }
  return { delta, none };
}

/** "If this Pokémon would be Knocked Out by damage from an attack, flip a coin...": how many such effects apply to it (one flip each). */
export function surviveKoCoinFlips(env: Env, s: GameState, slot: Slot, all = statics(env, s)): number {
  return onSlot(env, s, all, slot, 'surviveKoCoinFlip').length;
}

export function cantAttack(env: Env, s: GameState, slot: Slot, all = statics(env, s)): boolean {
  return onSlot(env, s, all, slot, 'cantAttack').some((x) => {
    const max = (x.effect as { ifEnergyAtMost?: number }).ifEnergyAtMost;
    return max === undefined || energyUnits(env, slot, s, all).length <= max;
  });
}

/** How many Pokémon Tool cards this Pokémon may have attached: 1, or more under a `toolSlots` effect (the largest counts). */
export function toolLimit(env: Env, s: GameState, slot: Slot, all = statics(env, s)): number {
  let n = 1;
  for (const x of onSlot(env, s, all, slot, 'toolSlots')) n = Math.max(n, (x.effect as { n: number }).n);
  return n;
}

/** How many "if any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage" effects apply to it (one flip each). */
export function damageCoinFlips(env: Env, s: GameState, slot: Slot, all = statics(env, s)): number {
  return onSlot(env, s, all, slot, 'damageCoinFlip').length;
}

/** Does a "retreat coin flip" effect (Goodra's Slimy Sliding) apply to this player's retreat? One flip however many there are. */
export function retreatCoinFlip(p: Player, all: LiveStatic[]): boolean {
  return all.some((x) => x.effect.k === 'retreatCoinFlip' && affectsPlayer(x, p));
}

/** The Tool card that lets this Pokémon's attack's coin flips be flipped again now (Backtrack Badge, unspent this turn), or undefined. */
export function coinReflipTool(env: Env, s: GameState, slot: Slot, all = statics(env, s)): number | undefined {
  const owner = ownerOf(s, slot);
  const used = s.p[owner].toolUsed ?? [];
  return onSlot(env, s, all, slot, 'coinReflip').find((x) => x.kind === 'tool' && !used.includes(x.src))?.src;
}

/** Does this Pokémon keep its Confusion when it evolves or devolves (Dizzying Valley)? */
export function confusionKept(env: Env, s: GameState, slot: Slot, all = statics(env, s)): boolean {
  return onSlot(env, s, all, slot, 'keepConfusion').length > 0;
}

/** Are this player's Pokémon in play, and the cards attached to them, kept out of their hand (Milotic's Mentally Calm)? */
export function returnToHandBlocked(env: Env, s: GameState, p: Player, all = statics(env, s)): boolean {
  void env;
  void s;
  return all.some((x) => x.effect.k === 'noReturnToHand' && affectsPlayer(x, p));
}

/** The "tries to use an attack" coin flips that apply to this Pokémon's attack right now: one entry per effect, each the number of coins it flips. */
export function attackCoinFlips(env: Env, s: GameState, slot: Slot, all = statics(env, s)): number[] {
  return onSlot(env, s, all, slot, 'attackCoinFlip').map((x) => (x.effect as { coins?: number }).coins ?? 1);
}

/** Can this Special Condition not affect this Pokémon (a `conditionImmunity` static on it)? */
export function conditionImmune(env: Env, s: GameState, slot: Slot, cond: SpecialCondition, all = statics(env, s)): boolean {
  return onSlot(env, s, all, slot, 'conditionImmunity').some((x) => {
    const c = (x.effect as { conditions?: SpecialCondition[] }).conditions;
    return !c || c.includes(cond);
  });
}

/** Can Energy be attached from hand to this Pokémon? */
export function canAttachFromHand(env: Env, s: GameState, slot: Slot, all = statics(env, s)): boolean {
  return onSlot(env, s, all, slot, 'cantAttachFromHand').length === 0;
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

/** Is this player stopped from playing these cards from their hand right now (a `playLock` of that kind applies to them)? */
export function playLocked(env: Env, s: GameState, p: Player, what: PlayLock, all = statics(env, s)): boolean {
  return all.some((x) => x.effect.k === 'playLock' && x.effect.what === what && affectsPlayer(x, p));
}

/** A Pokémon with the Ability "Put this Pokémon into play only with the effect of ...": it can't be played from the hand. */
export function putOnlyByEffect(d: CardDef): boolean {
  return d.kind === 'pokemon' && d.coverage === 'full' && d.abilities.some((a) => a.script?.putIntoPlayOnlyBy !== undefined);
}

/**
 * Is this player stopped from playing this card (an Ability-having Pokémon in the hand, put onto the Bench or played to evolve) by an
 * `abilityPokemon` play lock that applies to them? The Ability is the one printed on the card in hand: a Pokémon in hand has it
 * whatever is switching Abilities off in play (TPCi Rules Team 2025-05-29, ruling 2147).
 */
export function pokemonPlayLocked(env: Env, s: GameState, p: Player, d: CardDef, all = statics(env, s)): boolean {
  if (d.kind !== 'pokemon' || !d.abilities.length) return false;
  if (putOnlyByEffect(d)) return true; // Hero's Spirit: only an effect that names this Pokémon puts it into play
  return all.some((x) => x.effect.k === 'playLock' && x.effect.what === 'abilityPokemon' && affectsPlayer(x, p) && !(x.effect.except && defMatches(d, x.effect.except)));
}

/**
 * The damage counters a Special Condition of this Pokémon places at Pokémon Checkup on top of its own (`checkupCounters` effects on
 * it): the sum, each `noStack` key counted once.
 */
export function checkupExtraCounters(env: Env, s: GameState, slot: Slot, cond: 'poisoned' | 'burned', all = statics(env, s)): number {
  let n = 0;
  const once = new Set<string>();
  for (const x of onSlot(env, s, all, slot, 'checkupCounters')) {
    const e = x.effect as { cond: string; n: number; noStack?: string };
    if (e.cond !== cond) continue;
    if (e.noStack) {
      if (once.has(e.noStack)) continue;
      once.add(e.noStack);
    }
    n += e.n;
  }
  return n;
}

/**
 * Are the effects of an Item / Supporter card that `fromPlayer` plays from their hand, done to this Pokémon, prevented
 * (`preventTrainerEffects`)? Never for the player's own Pokémon.
 */
export function trainerEffectsPrevented(env: Env, s: GameState, slot: Slot, fromPlayer: Player, ttype: 'item' | 'supporter', all = statics(env, s)): boolean {
  if (ownerOf(s, slot) === fromPlayer) return false;
  return onSlot(env, s, all, slot, 'preventTrainerEffects').some((x) => (x.effect as { from: string[] }).from.includes(ttype));
}

/** May this Pokémon attack twice each turn right now (an `attackTwice` static that is in force)? */
export function canAttackTwice(env: Env, s: GameState, slot: Slot, all = statics(env, s)): boolean {
  return onSlot(env, s, all, slot, 'attackTwice').length > 0;
}

/**
 * The cards of a Pokémon that is being Knocked Out by damage from an attack and go to its owner's hand instead of the discard pile
 * (`koToHand` effects on it): those that always do, and those its owner may choose to ("you may put ... into your hand").
 */
export function koToHandCards(env: Env, s: GameState, slot: Slot, all = statics(env, s)): { always: number[]; may: number[] } {
  const always = new Set<number>();
  const may = new Set<number>();
  for (const x of onSlot(env, s, all, slot, 'koToHand')) {
    const e = x.effect as { cards: 'pokemon' | 'energy'; filter?: Filter; optional?: boolean };
    const cards = e.cards === 'pokemon' ? slot.cards : slot.energy.filter((c) => cardMatches(env, c, e.filter));
    for (const c of cards) (e.optional ? may : always).add(c);
  }
  for (const c of always) may.delete(c);
  return { always: [...always], may: [...may] };
}

/** The player's own first turn (the second player's first turn is turn 2). */
export function ownFirstTurn(s: GameState, p: Player): boolean {
  return s.turn === (p === s.first ? 1 : 2);
}

/**
 * May the card `d` (an Evolution Pokémon in `slot`'s owner's hand) be played onto this Pokémon to evolve it right now, by the
 * evolution rules and the effects that bend them? Not whether the player is locked out of evolving (`playLock`: the caller asks).
 *  - the name: the card evolves from this Pokémon's name, or an `evolveInto` effect on it names the card;
 *  - the timing: not on its owner's first turn, and not the turn it was played or evolved, unless an `evolveTiming` effect on it
 *    (that covers the card) lifts that.
 */
export function mayEvolve(env: Env, s: GameState, p: Player, slot: Slot, d: CardDef, all = statics(env, s)): boolean {
  if (d.kind !== 'pokemon' || d.stage === 0) return false;
  let named = def(env.ctx, topCard(slot)).name === d.evolvesFrom;
  if (!named) {
    for (const x of onSlot(env, s, all, slot, 'evolveInto')) {
      const e = x.effect as { evolvesFrom: string; filter?: Filter };
      if (e.evolvesFrom === d.evolvesFrom && defMatches(d, e.filter)) {
        named = true;
        break;
      }
    }
  }
  if (!named) return false;
  let firstTurn = false;
  let justPlayed = false;
  const own = ownFirstTurn(s, p);
  const fresh = slot.enteredTurn >= s.turn || slot.evolvedTurn >= s.turn;
  if (own || fresh) {
    for (const x of onSlot(env, s, all, slot, 'evolveTiming')) {
      const e = x.effect as { firstTurn?: boolean; justPlayed?: boolean; into?: Filter };
      if (e.into && !defMatches(d, e.into)) continue;
      firstTurn ||= !!e.firstTurn;
      justPlayed ||= !!e.justPlayed;
    }
  }
  if (own && !firstTurn) return false;
  if (fresh && !justPlayed) return false;
  return true;
}

/** How many Pokémon this player can have on their Bench: 5, or more under a `benchSize` effect whose condition they meet. */
export function benchLimit(env: Env, s: GameState, p: Player, all = statics(env, s)): number {
  let n = 5;
  for (const x of all) {
    if (x.effect.k !== 'benchSize' || !affectsPlayer(x, p) || x.effect.size <= n) continue;
    const need = x.effect.withPokemon;
    if (need && !allSlots(s.p[p]).some((sl) => slotMatches(env, sl, need, true, s))) continue;
    n = x.effect.size;
  }
  return n;
}

/** Defs of a player's Pokémon in play, for filters like "if you have X in play". */
export function inPlayDefs(env: Env, s: GameState, p: Player) {
  return allSlots(s.p[p]).map((sl) => def(env.ctx, topCard(sl)));
}

export { defMatches, opp, providesOn, type EnergyUnit };
