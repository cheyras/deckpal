/**
 * The effect interpreter. Runs the top frame of `s.stack` op by op until it
 * needs a decision (sets `s.pending` and returns) or the stack is empty.
 *
 * A decision is answered by storing the answer in the frame's `__a` variable
 * and re-running the same op, which consumes it -- so an op is the unit of
 * atomicity and every pause point is just (frame, pc).
 */
import { codeOf, def, ensureCode, type Env } from './context.js';
import type { Op } from './compile.js';
import type { CardZone, DamageIgnore, Dest, Duration, Filter, ReactEvent, SlotRef, SlotZone, SpecialCondition, Step, TriggerOn } from './dsl.js';
import { cardMatches, evalCond, evalExpr, resolveSlot, side, slotMatches, slotsIn, slotTypes, unitFits, type EvalCtx } from './eval.js';
import {
  attackCost,
  benchLimit,
  cardUnits,
  conditionImmune,
  damageIn,
  damageOut,
  damagePrevented,
  countersPrevented, // lane:darkrai
  effectsPrevented,
  canAttachFromHand,
  coinReflipTool,
  damageCoinFlips,
  hasNoAbilities,
  maxHp,
  ownerOf,
  returnToHandBlocked,
  statics,
  settleBrace,
  surviveKoSources, // lane:zoroark
  toolsDisabled, // lane:fighting
  trainerEffectsPrevented,
  weaknessOf,
  weaknessMultiplier,
} from './query.js';
import {
  allSlots,
  clearAttackEffects,
  draw,
  emit,
  findSlot,
  flipCoin,
  healSlot,
  newSlot,
  opp,
  removeFrom,
  shuffleDeck,
  takeFromZones,
  topCard,
} from './state.js';
import { CUSTOMS } from './customs.js';
import {
  ASLEEP,
  BURNED,
  CONFUSED,
  PARALYZED,
  POISONED,
  ROTATION,
  type Decision,
  type Frame,
  type GameState,
  type Pending,
  type Player,
  type Slot,
  type Val,
} from './types.js';

export function ec(f: Frame): EvalCtx {
  return { player: f.player, slot: f.slot, defender: (f.vars.__def as number) || 0, vars: f.vars };
}

/**
 * The turns a timed effect covers, first to last, for the player whose card made it ("your"). "Your next turn" is two turns away when
 * the effect is made during that player's own turn, and the very next one when it is made during the opponent's turn or the Checkup
 * after it (a reaction to their attack). "During your opponent's next turn" starts with that turn, not before: the rest of the turn the
 * effect was made in is not covered. PTCG Live's engine keeps the same distinction (immediate / on my next turn / on the opponent's next
 * turn).
 */
export function durationTurns(s: GameState, player: Player, d: Duration): { start: number; until: number } {
  const own = s.current === player;
  const mine = own ? s.turn + 2 : s.turn + 1;
  const theirs = own ? s.turn + 1 : s.turn + 2;
  switch (d) {
    case 'thisTurn':
      return { start: s.turn, until: s.turn };
    case 'oppNextTurn':
      return { start: theirs, until: theirs };
    case 'myNextTurn':
      return { start: mine, until: mine };
    case 'throughMyNextTurn':
      return { start: s.turn, until: mine };
  }
}

/** Ask the frame's chooser. If the answer is forced, answer it without asking. */
function ask(s: GameState, d: Decision, mode: 'cards' | 'slots' | 'index' | 'bool' | 'order'): void {
  const resume: Pending['resume'] = { k: 'frame', as: '__a', mode };
  s.pending = { decision: d, resume };
}

/** Clamp min/max to the options available (do as much as you can). */
function bounds(n: number, min: number, max: number): [number, number] {
  const hi = Math.max(0, Math.min(max, n));
  return [Math.min(Math.max(0, min), hi), hi];
}

/** True when the op needs no decision because only one answer is legal. */
function forced(n: number, min: number, max: number): boolean {
  return (min === max && max === n) || n === 0 || max === 0;
}

function takeAnswer(f: Frame): Val | undefined {
  if (!('__a' in f.vars)) return undefined;
  const v = f.vars.__a;
  delete f.vars.__a;
  return v;
}

const COND_BITS: Record<SpecialCondition, number> = {
  asleep: ASLEEP,
  confused: CONFUSED,
  paralyzed: PARALYZED,
  poisoned: POISONED,
  burned: BURNED,
};

/** Run the stack until it empties or a decision is pending. */
export function run(env: Env, s: GameState): void {
  while (s.stack.length && !s.pending && s.phase !== 'over') {
    const f = s.stack[s.stack.length - 1] as Frame;
    const code = codeOf(env.ctx, f.code);
    if (f.pc >= code.length) {
      s.stack.pop();
      onFrameDone(env, s, f);
      continue;
    }
    s.steps++;
    const op = code[f.pc] as Op;
    const r = exec(env, s, f, op);
    if (r === 'next') f.pc++;
    else if (r === 'pop') {
      s.stack.pop();
      onFrameDone(env, s, f);
    }
    // 'wait': pending set (or a frame pushed) — loop re-evaluates.
  }
}

/** A trainer finished: it goes from limbo to the discard pile. */
function onFrameDone(env: Env, s: GameState, f: Frame): void {
  if (f.kind === 'trainer' && s.limbo.includes(f.src)) {
    removeFrom(s.limbo, f.src);
    const d = def(env.ctx, f.src);
    if (d.ttype !== 'stadium' && d.ttype !== 'tool') s.p[f.player].discard.push(f.src);
  }
  const re = f.vars.__reattach;
  if (Array.isArray(re) && re.length) {
    const slot = findSlot(s, f.slot);
    for (const c of re) {
      if (slot && removeFrom(s.p[f.player].discard, c)) slot.slot.energy.push(c);
    }
  }
  // Nitro Fire Energy: discarded by an effect of its Pokémon's own attack, it goes into its owner's hand after the attack's damage and effects.
  const th = f.vars.__toHand;
  if (Array.isArray(th) && th.length) {
    const ps = s.p[f.player];
    for (const c of th) {
      if (removeFrom(ps.discard, c)) {
        ps.hand.push(c);
        ps.revealed.push(c); // it was discarded face up: the opponent knows where it went
      }
    }
  }
}

type R = 'next' | 'wait' | 'pop';

function exec(env: Env, s: GameState, f: Frame, op: Op): R {
  const e = ec(f);
  switch (op.o) {
    case 'jif':
      if (!evalCond(env, s, e, op.cond)) f.pc = op.to - 1;
      return 'next';
    case 'jmp':
      f.pc = op.to - 1;
      return 'next';
    case 'set':
      f.vars[op.v] = evalExpr(env, s, e, op.value);
      return 'next';
    case 'jz':
      if (((f.vars[op.v] as number) ?? 0) <= 0) f.pc = op.to - 1;
      return 'next';
    case 'dec':
      f.vars[op.v] = ((f.vars[op.v] as number) ?? 0) - 1;
      return 'next';
    case 'ask': {
      const a = takeAnswer(f);
      if (a !== undefined) {
        f.vars[op.as] = a;
        return 'next';
      }
      ask(s, { player: f.player, kind: 'yesno', prompt: op.prompt, min: 1, max: 1, labels: ['Yes', 'No'] }, 'bool');
      return 'wait';
    }
    case 'jfalse':
      if (!f.vars[op.v]) f.pc = op.to - 1;
      return 'next';
    case 'confusion':
      return confusion(env, s, f);
    case 'used': {
      // A once-per-turn trigger was accepted: it can't be used again this turn (the key is a negative "ability index").
      const sl = findSlot(s, f.slot)?.slot;
      const key = f.vars.__once;
      if (sl && typeof key === 'number' && !sl.usedAbilities.includes(key)) sl.usedAbilities.push(key);
      return 'next';
    }
    case 'attackDamage':
      return attackDamage(env, s, f);
    case 'step':
      return step(env, s, f, op.s);
  }
}

// ---------------------------------------------------------------------------
// Attack sequence
// ---------------------------------------------------------------------------

function confusion(env: Env, s: GameState, f: Frame): R {
  const slot = findSlot(s, f.slot)?.slot;
  if (!slot || !(slot.cond & CONFUSED)) {
    if (slot) recordAttack(s, f.player, slot);
    return 'next';
  }
  if (flipCoin(env, s, f.player, 'confusion')) {
    recordAttack(s, f.player, slot);
    return 'next';
  }
  // Tails: put 3 damage counters on the attacker (more when the Confusion came with a larger amount) and the attack ends.
  const n = slot.confusionCounters ?? 3;
  slot.damage += n * 10;
  emit(env, { type: 'counters', player: f.player, slot: slot.id, n });
  return 'pop';
}

/**
 * This Pokémon used an attack (it was not stopped by a coin flip, nor by a failed Confusion flip: ruling 2087): note it for "used an
 * attack during your last turn". The record is per player and turn, and keeps the turn before.
 */
function recordAttack(s: GameState, p: Player, slot: Slot): void {
  const ps = s.p[p];
  const rec = ps.attackRec;
  if (rec && rec.turn === s.turn) {
    if (!rec.slots.includes(slot.id)) ps.attackRec = { turn: s.turn, slots: [...rec.slots, slot.id], cards: [...rec.cards, topCard(slot)] };
    return;
  }
  if (rec) ps.prevAttackRec = rec;
  ps.attackRec = { turn: s.turn, slots: [slot.id], cards: [topCard(slot)] };
}

function attackDamage(env: Env, s: GameState, f: Frame): R {
  const di = f.vars.__atkDef as number;
  const ai = f.vars.__atkIdx as number;
  const d = env.ctx.defs[di];
  if (!d) return 'next';
  const atk = d.attacks[ai];
  if (!atk) return 'next';
  const script = d.coverage === 'full' ? d.script?.attacks?.[atk.name] : undefined;
  const amount = script?.damage !== undefined ? evalExpr(env, s, ec(f), script.damage) : atk.baseDamage;
  if (amount <= 0 && !script?.damage) return 'next';
  const to = script?.target ?? 'defender';
  return dealDamage(env, s, f, amount, to, script?.ignore); // lane:fighting (ignore)
}

/**
 * Are the effects of the Item or Supporter card this frame belongs to stopped on this Pokémon (an Ability or card text that says
 * "whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to this Pokémon")?
 */
function trainerBlocked(env: Env, s: GameState, f: Frame, t: Slot, all?: ReturnType<typeof statics>): boolean {
  if (f.kind !== 'trainer') return false;
  const ttype = def(env.ctx, f.src).ttype;
  return (ttype === 'item' || ttype === 'supporter') && trainerEffectsPrevented(env, s, t, f.player, ttype, all);
}

function targetsOf(env: Env, s: GameState, f: Frame, to: SlotRef | { each: SlotZone; filter?: Filter } | { v: string }): Slot[] {
  if (typeof to === 'object' && 'each' in to) {
    return slotsIn(s, f.player, to.each).filter((sl) => slotMatches(env, sl, to.filter, true, s));
  }
  if (typeof to === 'object' && 'v' in to) {
    const v = f.vars[to.v];
    const ids = Array.isArray(v) ? v : typeof v === 'number' ? [v] : [];
    return ids.map((id) => findSlot(s, id)?.slot).filter((x): x is Slot => !!x);
  }
  const sl = resolveSlot(s, ec(f), to);
  return sl ? [sl] : [];
}

/** Attack damage through the full pipeline (rulebook p.14/20). */
function dealDamage(
  env: Env,
  s: GameState,
  f: Frame,
  base: number,
  to: SlotRef | { each: SlotZone; filter?: Filter } | { v: string },
  ignore?: DamageIgnore, // lane:fighting
): R {
  // Everything this frame damages is one event (an attack's damage to several Pokémon, or in several steps, happens together).
  s.ev = (f.vars.__dmgEv as number | undefined) ?? (f.vars.__dmgEv = beginEvent(s));
  const attacker = findSlot(s, f.slot)?.slot;
  const all = statics(env, s);
  const atkTypes = attacker ? slotTypes(env, attacker, s) : []; // "it is {F} and {P} type": both count against Weakness and Resistance
  for (const target of targetsOf(env, s, f, to)) {
    const owner = ownerOf(s, target);
    const isActive = s.p[owner].active === target;
    if (trainerBlocked(env, s, f, target, all)) continue; // an Item or Supporter's damage to a Pokémon that is protected from it
    // lane:fighting — "isn't affected by any effects on your opponent's Active Pokémon" (or "on those Pokémon": Benched ones too)
    const noDefEffects = !!ignore?.defenderEffects && owner !== f.player;
    // Damage done by an Ability, a Trainer or another effect that is not an attack is just that damage: the attack-damage steps below
    // (the attacker's "N more damage", Weakness and Resistance, "takes N less damage from attacks", prevention of damage "by attacks",
    // the Tera rule) are for attacks only (rulebook, Weakness and Resistance: "only to damage done by attacks").
    const byAttack = f.kind === 'attack';
    let dmg = base;
    // "Attacks used by ... do 30 less damage" reduce all the damage the attack does, Benched Pokémon and its own side included (ruling 1822);
    // the increases ("30 more damage") are for the opponent's Active Pokémon.
    if (dmg > 0 && attacker && byAttack) {
      if (owner !== f.player && isActive) dmg += damageOut(env, s, attacker, target, all);
      else dmg += damageOut(env, s, attacker, target, all, true);
    }
    if (dmg > 0 && isActive && byAttack) { // an attack's damage to its own Active Pokémon counts too (ruling 620)
      // Weakness and Resistance, and effects that change them, are not "effects on" the Defending
      // Pokémon for `defenderEffects` (Shred rulings: Allergy Panic still makes Weakness x4).
      const w = weaknessOf(env, s, target, all);
      if (!ignore?.weakness && w && atkTypes.includes(w)) dmg *= weaknessMultiplier(env, s, target, all);
      const r = def(env.ctx, topCard(target)).resistance;
      if (!ignore?.resistance && r && atkTypes.includes(r.type)) dmg -= r.amount;
    }
    const preIn = dmg; // before the "takes N less damage" effects, for the Berries
    const reducers: number[] = [];
    if (dmg > 0 && !noDefEffects && byAttack) dmg += damageIn(env, s, target, all, f.player, attacker ?? undefined, reducers); // lane:metal (fromOpp) + lane:fighting (ignore)
    if (dmg < 0) dmg = 0;
    // lane:ghost (attacker). A reduction that left nothing is still checked: prevented damage is not "damaged by an attack" for the Berries.
    const prevented = byAttack && (dmg > 0 || reducers.length > 0) && !noDefEffects && damagePrevented(env, s, target, f.player, all, attacker ?? undefined, dmg);
    if (prevented) dmg = 0;
    // "If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage." Its owner flips, only when damage
    // would really be done, and not at all for an attack that isn't affected by effects on the Defending Pokémon (ruling 2040).
    if (dmg > 0 && !noDefEffects && f.kind === 'attack') {
      for (let n = damageCoinFlips(env, s, target, all); n > 0 && dmg > 0; n--) if (flipCoin(env, s, owner)) dmg = 0;
    }
    // "If the Pokémon this card is attached to is damaged by an attack ..., it takes N less damage, and discard this card": the Tool
    // whose effect reduced the damage reacts, even when the reduction took it to 0 and wherever the Pokémon is.
    if (reducers.length && preIn > 0 && !prevented && f.kind === 'attack' && owner !== f.player) {
      for (const card of new Set(reducers)) queueTriggers(env, s, target, owner, 'damageReduced', { __attacker: f.slot }, card);
    }
    if (dmg <= 0) continue;
    // A second hit on a Pokémon whose Knock Out Resolute Heart / Survival Brace already replaced lands on its 10 remaining HP, no longer at full HP.
    if (target.braced) settleBrace(env, s, target);
    // lane:zoroark — Survival Brace: at full HP, damage from an opponent's attack that would Knock the Pokémon
    // Out leaves it at 10 HP instead, then the Tool is discarded.
    if (f.kind === 'attack' && owner !== f.player && target.damage === 0) {
      const hp = maxHp(env, s, target, all);
      const brace = dmg >= hp ? surviveKoSources(env, s, target, all)[0] : undefined;
      if (brace) {
        // The attack's full damage is placed; "10 HP remaining" is settled when Knock Outs are checked, at the max HP it has then
        // (Lively Stadium discarded by the same attack: 190 damage on a 200 HP Pikachu ex, ruling 2041). See resolveKOs.
        target.braced = true;
        if (brace.kind === 'tool' && target.tools.includes(brace.src)) {
          target.tools = target.tools.filter((c) => c !== brace.src);
          s.p[owner].discard.push(brace.src);
        }
      }
    }
    target.damage += dmg;
    // lane:fighting — remember who this attack damaged (Legacy Energy: "Knocked Out by damage from an attack")
    if (f.kind === 'attack' && owner !== f.player) {
      s.attackHits = [...(s.attackHits ?? []), target.id];
      // "damage this Pokémon took from an attack during your opponent's last turn": a running total per turn.
      target.attackDmg = (target.attackDmgTurn === s.turn ? (target.attackDmg ?? 0) : 0) + dmg;
      target.attackDmgTurn = s.turn;
    }
    emit(env, { type: 'damage', player: owner, slot: target.id, amount: dmg, bySlot: f.slot });
    if (owner !== f.player && isActive) queueTriggers(env, s, target, owner, 'damagedByAttackActive', { __attacker: f.slot, __damage: dmg });
    // Timed effects an attack left on this Pokémon: "if this Pokémon is damaged by an attack (even if it is Knocked Out), ..."
    if (f.kind === 'attack' && owner !== f.player) {
      queueReactions(env, s, target, 'damagedByAttack', { __attacker: f.slot, __def: target.id }, true);
      // Abilities and Tools of the damaged Pokémon, Active or Benched: once per attack, not once per damage instance.
      queueTriggers(env, s, target, owner, 'damagedByAttack', { __attacker: f.slot, __damage: dmg }, undefined, true);
      // ...and the Abilities of the owner's other Pokémon that watch for their Active Pokémon being damaged (Spiritomb's Spiteful Swirl).
      if (isActive) {
        for (const w of allSlots(s.p[owner])) {
          queueTriggers(env, s, w, owner, 'allyActiveDamagedByAttack', { __target: target.id, __attacker: f.slot }, undefined, true);
        }
      }
    }
  }
  return 'next';
}

/**
 * Which "at the same time" moment a trigger belongs to and who orders it (Advanced Player's Rulebook v3.4): effects that activate when a
 * Pokémon is damaged: the damaged Pokémon's player (E-03); Knock Out step 2, an Energy attach, an Evolution from the hand (a Pokémon
 * Evolving happens on its player's turn) and the end of the turn: the player whose turn it is (E-04, the Energy attach entry, the
 * end-of-turn entry); Pokémon Checkup: the player whose turn is next.
 */
export function orderOf(s: GameState, on: TriggerOn | ReactEvent, owner: Player): Frame['order'] {
  const o = orderKind(s, on, owner);
  return o ? { ...o, ev: s.ev ?? 0 } : undefined;
}

/** A new event instance: the triggers queued from here until the next one are one "at the same time" batch (per moment, kind and chooser). */
export function beginEvent(s: GameState): number {
  s.evNext = (s.evNext ?? 0) + 1;
  s.ev = s.evNext;
  return s.ev;
}

function orderKind(s: GameState, on: TriggerOn | ReactEvent, owner: Player): { g: string; by: Player } | undefined {
  switch (on) {
    case 'damagedByAttack':
    case 'damagedByAttackActive':
    case 'allyActiveDamagedByAttack':
      return { g: 'damage', by: owner };
    case 'knockedOutByAttack':
      return { g: 'ko', by: s.current };
    case 'attachFromHand':
    case 'oppAttachFromHand':
    case 'allyAttachFromHand':
      return { g: 'attach', by: s.current };
    case 'evolveFromHand':
    case 'oppEvolveFromHand':
      return { g: 'evolve', by: s.current };
    case 'checkup':
      return { g: 'checkup', by: opp(s.current) };
    case 'endOfTurn':
      return { g: 'end', by: s.current };
    default:
      return undefined;
  }
}

/** Queue triggers on a Pokémon (its Abilities) and on its attached Tools. */
export function queueTriggers(
  env: Env,
  s: GameState,
  slot: Slot,
  owner: Player,
  // lane:misc — 'checkup' and 'endOfTurn' added; attached Energy are trigger sources too (Ignition Energy).
  on: TriggerOn,
  /** lane:ghost — initial frame variables (e.g. `__target` for oppAttachFromHand). */
  vars?: Record<string, Val>,
  /** Only the triggers of this card (a Tool whose effect is the reason). */
  only?: number,
  /** Skip a trigger already waiting for this Pokémon (the event can repeat within one action). */
  dedupe?: boolean,
  /** For triggers marked `noStack`: the ones already queued for this event, so that only the first Pokémon's copy fires. */
  seen?: Set<string>,
): void {
  // A Pokémon that evolves with damage at or over its new HP (a Basic-only HP bonus stopped applying) is Knocked Out before any "when you
  // play this Pokémon from your hand to evolve" trigger could happen (ruling 2122): its own triggers are not queued.
  const koOnEvolve = on === 'evolveFromHand' && slot.damage > 0 && slot.damage >= maxHp(env, s, slot);
  const sources = koOnEvolve ? [] : [topCard(slot), ...(toolsDisabled(env, s) ? [] : slot.tools), ...slot.energy]; // lane:misc energy triggers; lane:fighting Jamming Tower
  let noAb: boolean | undefined; // computed only when the Pokemon's own card has a trigger for this event (it walks every static)
  for (const c of sources) {
    if (only !== undefined && c !== only) continue;
    const d = def(env.ctx, c);
    if (d.coverage !== 'full') continue;
    const isPokemon = c === topCard(slot);
    if (isPokemon && !d.triggers.some((t) => t.t.on === on)) continue;
    if (isPokemon && (noAb ??= hasNoAbilities(env, s, slot))) continue;
    for (const [ti, t] of d.triggers.entries()) {
      if (t.t.on !== on) continue;
      // "Once during your turn": a Pokémon's trigger used already this turn (a negative key in usedAbilities) is not offered again.
      const onceKey = t.t.oncePerTurn && isPokemon ? -(1 + ti) : undefined;
      if (onceKey !== undefined && (slot.usedAbilities.includes(onceKey) || s.current !== owner)) continue;
      const frame: Frame = {
        code: t.code,
        pc: 0,
        vars: { ...vars, ...(onceKey !== undefined ? { __once: onceKey } : {}) }, // lane:ghost
        player: owner,
        src: c,
        slot: slot.id,
        kind: isPokemon ? 'ability' : slot.tools.includes(c) ? 'tool' : 'energy',
      };
      if (t.t.when && !evalCond(env, s, ec(frame), t.t.when)) continue;
      // "takes 240 or more damage from an attack from your opponent's Mega Evolution Pokémon ex": the amount and the attacker.
      if (t.t.minDamage !== undefined && !(typeof vars?.__damage === 'number' && vars.__damage >= t.t.minDamage)) continue;
      if (t.t.attacker) {
        const by = typeof vars?.__attacker === 'number' ? findSlot(s, vars.__attacker)?.slot : undefined;
        if (!by || !slotMatches(env, by, t.t.attacker, true, s)) continue;
      }
      if (dedupe && s.queued.some((q) => q.code === frame.code && q.slot === frame.slot && q.src === frame.src)) continue;
      if (t.t.noStack && seen) {
        if (seen.has(frame.code)) continue;
        seen.add(frame.code);
      }
      if (t.t.optional) frame.vars.__optional = true;
      const order = orderOf(s, on, owner);
      if (order) frame.order = order;
      s.queued.push(frame);
    }
  }
  // The opponent's Abilities that watch for a Pokémon evolving from the hand (Team Rocket's Ampharos): every route that fires the
  // Evolution's own triggers (the turn action, Rare Candy) fires these, after them (the evolved Pokémon's owner has theirs first:
  // TPCi Rules Team 2025-05-29, ruling 2146).
  if (on === 'evolveFromHand' && s.phase === 'main') {
    const seen = new Set<string>();
    for (const w of allSlots(s.p[opp(owner)])) queueTriggers(env, s, w, opp(owner), 'oppEvolveFromHand', { __target: slot.id }, undefined, false, seen);
  }
}

/**
 * lane:misc — the Stadium in play reacts to a Pokémon put onto its owner's Bench during that
 * player's turn (Risky Ruins). Called for Pokémon benched from hand and by effects (searches).
 */
export function queueStadiumBench(env: Env, s: GameState, slot: Slot, owner: Player): void {
  if (!s.stadium || s.phase !== 'main' || s.current !== owner) return;
  const d = def(env.ctx, s.stadium.card);
  if (d.coverage !== 'full') return;
  for (const t of d.triggers) {
    if (t.t.on !== 'pokemonBenched') continue;
    const frame: Frame = { code: t.code, pc: 0, vars: {}, player: owner, src: s.stadium.card, slot: slot.id, kind: 'stadium' };
    if (t.t.when && !evalCond(env, s, ec(frame), t.t.when)) continue;
    if (t.t.optional) frame.vars.__optional = true;
    s.queued.push(frame);
  }
}

/**
 * A card of `owner`'s deck was discarded from there by the other player's effect `f`: its own "if this Pokémon is discarded from
 * your deck by an effect of an attack or Ability from your opponent's Pokémon, or by an effect of your opponent's Item or Supporter
 * cards" trigger (Ferrothorn's Startling Drop) is queued, for the card's owner, during the opponent's turn.
 */
function queueDeckDiscard(env: Env, s: GameState, f: Frame, card: number, owner: Player): void {
  if (s.phase !== 'main' || s.current === owner) return;
  const by = f.kind === 'attack' || f.kind === 'ability' || (f.kind === 'trainer' && ['item', 'supporter'].includes(def(env.ctx, f.src).ttype ?? ''));
  if (!by) return;
  const d = def(env.ctx, card);
  if (d.coverage !== 'full') return;
  for (const t of d.triggers) {
    if (t.t.on !== 'discardedFromDeck') continue;
    const frame: Frame = { code: t.code, pc: 0, vars: {}, player: owner, src: card, slot: 0, kind: 'ability' };
    if (t.t.when && !evalCond(env, s, ec(frame), t.t.when)) continue;
    if (t.t.optional) frame.vars.__optional = true;
    s.queued.push(frame);
  }
}

/**
 * The `react` timed effects on a Pokémon that wait for `event`: queue their programs (they run once the stack is empty, before
 * Knock Outs are checked). The effect's controller runs them; an attack's effect stays an effect of an attack, so what it does to
 * the Attacking Pokémon can be prevented (Mist Energy: TPCi 2024-03-21 ruling 1958, 2026-07-16 ruling 2408). `once`: not again
 * for an effect that is already queued for this Pokémon (one reaction per attack, however many times it was hit).
 */
export function queueReactions(env: Env, s: GameState, slot: Slot, event: ReactEvent, vars: Record<string, Val>, once = false): void {
  void env;
  for (const te of s.effects) {
    if (te.slot !== slot.id || te.until < s.turn || (te.start ?? 0) > s.turn || te.static.k !== 'react' || te.static.event !== event || !te.code) continue;
    if (once && s.queued.some((q) => q.code === te.code && q.vars.__def === slot.id)) continue;
    const order = orderOf(s, event, ownerOf(s, slot)); // its own object per frame: picking one must not mark the others
    s.queued.push({ code: te.code, pc: 0, vars: { ...vars }, player: te.by ?? te.player, src: te.src, slot: te.from ?? slot.id, kind: te.fromAttack ? 'attack' : 'trigger', ...(order ? { order } : {}) });
  }
}

/**
 * lane:ghost — `owner` attached an Energy card from their hand to `target`: fire the
 * opponent's "whenever your opponent attaches an Energy card from their hand" Abilities, and the timed effects on `target`
 * that wait for it.
 */
export function queueOppAttachTriggers(env: Env, s: GameState, owner: Player, target: Slot, newEvent = true): void {
  if (newEvent) beginEvent(s);
  const watcher = opp(owner);
  for (const w of allSlots(s.p[watcher])) queueTriggers(env, s, w, watcher, 'oppAttachFromHand', { __target: target.id });
  // ...and the Abilities of the player's own Pokémon that watch for it (Magearna's Auto Heal).
  for (const w of allSlots(s.p[owner])) queueTriggers(env, s, w, owner, 'allyAttachFromHand', { __target: target.id });
  queueReactions(env, s, target, 'attachFromHand', { __target: target.id, __def: target.id });
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function cardsInZone(s: GameState, p: Player, z: CardZone): number[] {
  return s.p[p][z];
}

function moveCards(env: Env, s: GameState, f: Frame, cards: number[], to: Dest, who: Player, anyStage = false): number[] {
  const ps = s.p[who];
  const moved: number[] = [];
  const revealed = (f.vars.__revealed as number[] | undefined) ?? [];
  // How many Pokémon each Bench holds is decided when the effect starts: a Tera Pokémon put onto the Bench by it doesn't make room
  // for the next one (Area Zero Underdepths, TPCi Rules Team 2024-09-12, ruling 2024).
  const room: (number | undefined)[] = [];
  for (const c of cards) {
    const owner = env.ctx.owner[c] as Player;
    const ops = s.p[owner];
    if (to === 'bench') {
      const d = def(env.ctx, c);
      const asBasic = d.kind === 'trainer' && !!d.script?.fix?.playAsBasic; // lane:ghost (Antique fossils)
      if ((d.kind !== 'pokemon' && !asBasic) || (d.stage !== 0 && !anyStage) || ops.bench.length >= (room[owner] ??= benchLimit(env, s, owner))) continue;
      if (!takeFromZones(ops, c)) continue;
      const sl = newSlot(s, c);
      ops.bench.push(sl);
      emit(env, { type: 'play_to_bench', player: owner, card: c, slot: sl.id });
      queueStadiumBench(env, s, sl, owner); // lane:misc
      moved.push(c);
      continue;
    }
    // "This card can't be put into your hand or deck from the discard pile": it stays where it is.
    if ((to === 'hand' || to === 'deck' || to === 'deckTop' || to === 'deckBottom') && def(env.ctx, c).script?.noRecoverFromDiscard && ops.discard.includes(c)) continue;
    const fromDeck = to === 'discard' && owner !== f.player && ops.deck.includes(c);
    // A card that goes to the hand from a zone both players see (the discard pile, the Lost Zone, in play) is known to be in that
    // hand: the opponent saw it move (Compendium #787).
    const wasPublic =
      to === 'hand' &&
      (ops.discard.includes(c) || ops.lost.includes(c) || s.limbo.includes(c) || allSlots(ops).some((sl) => sl.cards.includes(c) || sl.energy.includes(c) || sl.tools.includes(c)));
    if (!takeFromZones(ops, c) && !removeFrom(s.limbo, c)) continue;
    moved.push(c);
    if (fromDeck) queueDeckDiscard(env, s, f, c, owner);
    switch (to) {
      case 'hand':
        ops.hand.push(c);
        if ((revealed.includes(c) || wasPublic) && !ops.revealed.includes(c)) ops.revealed.push(c);
        break;
      case 'discard':
        ops.discard.push(c);
        break;
      case 'lost':
        ops.lost.push(c);
        break;
      case 'deckTop':
        ops.deck.push(c);
        if (owner === f.player) ops.knownTop++;
        break;
      case 'deckBottom':
        ops.deck.unshift(c);
        break;
      case 'deck':
        ops.deck.push(c);
        break;
    }
  }
  if (to === 'discard' && moved.length) emit(env, { type: 'discard', player: who, cards: moved });
  void ps;
  return moved;
}

function step(env: Env, s: GameState, f: Frame, st: Step): R {
  const e = ec(f);
  switch (st.op) {
    case 'chooseCards':
      return chooseCards(env, s, f, st);
    case 'chooseSlots': {
      const a = takeAnswer(f);
      if (a !== undefined) {
        f.vars[st.as] = a as number[];
        return 'next';
      }
      let opts = slotsIn(s, f.player, st.from).filter((sl) => slotMatches(env, sl, st.filter, true, s));
      // An attack or Ability can't choose an opponent's Pokémon that is protected from its effects... but
      // choosing a damage target is not an effect, so no filtering here; prevention applies at resolution.
      const [min, max] = bounds(opts.length, evalExpr(env, s, e, st.min), evalExpr(env, s, e, st.max));
      const ids = opts.map((x) => x.id);
      if (forced(ids.length, min, max)) {
        f.vars[st.as] = max === 0 ? [] : ids.slice(0, max);
        return 'next';
      }
      const chooser = side(e, st.chooser);
      ask(s, { player: chooser, kind: 'slots', prompt: st.prompt ?? 'Choose Pokémon', min, max, values: ids }, 'slots');
      return 'wait';
    }
    case 'chooseOption': {
      const a = takeAnswer(f);
      if (a !== undefined) {
        f.vars[st.as] = (a as number[])[0] ?? 0;
        return 'next';
      }
      ask(
        s,
        { player: side(e, st.chooser), kind: 'option', prompt: st.prompt ?? 'Choose', min: 1, max: 1, labels: st.options },
        'index',
      );
      return 'wait';
    }
    case 'move': {
      const who = side(e, st.who);
      let cards: number[];
      if (typeof st.cards === 'string') {
        const v = f.vars[st.cards];
        cards = Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
      } else if ('top' in st.cards) {
        const w = side(e, st.cards.who);
        const n = evalExpr(env, s, e, st.cards.top);
        const deck = s.p[w].deck;
        cards = deck.slice(Math.max(0, deck.length - n)).reverse();
      } else {
        cards = cardsInZone(s, side(e, st.cards.who), st.cards.all).slice();
      }
      const moved = moveCards(env, s, f, cards, st.to, who, st.anyStage);
      if (st.as) f.vars[st.as] = moved;
      return 'next';
    }
    case 'putOnTop': {
      const v = f.vars[st.cards];
      const cards = Array.isArray(v) ? v.slice() : [];
      if (cards.length <= 1) {
        moveCards(env, s, f, cards, 'deckTop', f.player);
        return 'next';
      }
      const a = takeAnswer(f);
      if (a !== undefined) {
        // Answer order = top first; push in reverse so the first chosen ends on top.
        const order = (a as number[]).map((i) => cards[i] as number);
        moveCards(env, s, f, order.reverse(), 'deckTop', f.player);
        return 'next';
      }
      ask(
        s,
        {
          player: f.player,
          kind: 'order',
          prompt: 'Order these cards (first = top)',
          min: cards.length,
          max: cards.length,
          values: cards,
        },
        'order',
      );
      return 'wait';
    }
    case 'draw':
      draw(env, s, side(e, st.who), evalExpr(env, s, e, st.n));
      return 'next';
    case 'shuffle':
      shuffleDeck(env, s, side(e, st.who));
      return 'next';
    case 'attach': {
      const target = resolveSlot(s, e, st.to);
      const v = f.vars[st.cards];
      const cards = Array.isArray(v) ? v : [];
      if (!target) return 'next';
      for (const c of cards) {
        const owner = env.ctx.owner[c] as Player;
        const fromHand = s.p[owner].hand.includes(c); // lane:ghost
        if (fromHand && !canAttachFromHand(env, s, target)) continue;
        const only = def(env.ctx, c).script?.attachOnly; // "This card can only be attached to a Team Rocket's Pokémon."
        if (only && !slotMatches(env, target, only, true, s)) continue;
        if (!takeFromZones(s.p[owner], c)) continue;
        target.energy.push(c);
        emit(env, { type: 'attach', player: owner, card: c, slot: target.id });
        if (fromHand && def(env.ctx, c).kind === 'energy') queueOppAttachTriggers(env, s, ownerOf(s, target), target); // lane:ghost
      }
      return 'next';
    }
    case 'discardEnergy':
      return discardEnergy(env, s, f, st);
    case 'damage': {
      const amount = evalExpr(env, s, e, st.amount);
      return dealDamage(env, s, f, amount, st.to ?? 'defender', st.ignore); // lane:fighting (ignore)
    }
    case 'counters': {
      const n = evalExpr(env, s, e, st.n);
      if (n <= 0) return 'next';
      const kind = f.kind === 'ability' ? 'ability' : 'attack';
      const all = statics(env, s);
      for (const t of targetsOf(env, s, f, st.to)) {
        if (trainerBlocked(env, s, f, t, all)) continue;
        if ((f.kind === 'attack' || f.kind === 'ability') && effectsPrevented(env, s, t, f.player, kind, all)) continue;
        if ((f.kind === 'attack' || f.kind === 'ability') && countersPrevented(env, s, t, f.player, kind, all)) continue; // lane:darkrai
        if (t.braced) settleBrace(env, s, t); // Resolute Heart's save covered the attack's damage only; counters are not damage, so they land on the 10 HP it left
        t.damage += n * 10;
        emit(env, { type: 'counters', player: ownerOf(s, t), slot: t.id, n });
      }
      return 'next';
    }
    case 'heal': {
      const amount = evalExpr(env, s, e, st.amount);
      if (typeof st.to === 'object' && 'each' in st.to) {
        // "heal all damage from each of your Tera Pokémon": every Pokémon in the zone that matches. Healing the opponent's is an
        // effect of the attack or Ability (Hide 'n' Sneak protects it).
        const all = statics(env, s);
        let total = 0;
        for (const t of targetsOf(env, s, f, st.to)) {
          if ((f.kind === 'attack' || f.kind === 'ability') && ownerOf(s, t) !== f.player && effectsPrevented(env, s, t, f.player, f.kind, all)) continue;
          total += healSlot(s, t, amount, env);
        }
        if (st.as) f.vars[st.as] = total;
        return 'next';
      }
      const t = resolveSlot(s, e, st.to);
      const removed = t ? healSlot(s, t, amount, env) : 0;
      if (st.as) f.vars[st.as] = removed; // "if you healed any damage in this way": 0 when the Pokémon can't be healed
      return 'next';
    }
    case 'condition': {
      const t = resolveSlot(s, e, st.to);
      if (!t) return 'next';
      // Rulebook p.15: Special Conditions affect only Active Pokémon; a Benched Pokémon can't be given one.
      if (!findSlot(s, t.id)?.active) return 'next';
      if (trainerBlocked(env, s, f, t)) return 'next';
      if ((f.kind === 'attack' || f.kind === 'ability') && effectsPrevented(env, s, t, f.player, f.kind)) return 'next';
      if (def(env.ctx, topCard(t)).script?.fix?.playAsBasic?.noConditions) return 'next'; // lane:ghost
      if (conditionImmune(env, s, t, st.cond)) return 'next'; // "can't be affected by any Special Conditions" / "can't be Confused"
      applyCondition(t, st.cond, s.turn, st.counters);
      emit(env, { type: 'condition', player: ownerOf(s, t), slot: t.id, cond: st.cond });
      return 'next';
    }
    case 'switch':
      return switchStep(env, s, f, st);
    case 'flip': {
      const doFlip = (): void => {
        let heads = 0;
        if (st.n === 'untilTails') {
          // Bounded so a forced-heads replay can't loop forever.
          for (let i = 0; i < 100 && flipCoin(env, s, f.player); i++) heads++;
        } else {
          const n = evalExpr(env, s, e, st.n);
          for (let i = 0; i < n; i++) if (flipCoin(env, s, f.player)) heads++;
        }
        f.vars[st.as] = heads;
      };
      // Backtrack Badge: asked whether to ignore the results and flip the attack's coins again.
      if (f.vars.__rfp !== undefined) {
        const a = takeAnswer(f);
        if (a === undefined) return 'wait';
        const tool = f.vars.__rfp as number;
        delete f.vars.__rfp;
        if (a === true) {
          s.p[f.player].toolUsed = [...(s.p[f.player].toolUsed ?? []), tool];
          doFlip();
        }
        return 'next';
      }
      doFlip();
      if (f.kind === 'attack') {
        const holder = findSlot(s, f.slot)?.slot;
        const tool = holder ? coinReflipTool(env, s, holder) : undefined;
        if (tool !== undefined && flipsOnce(env, f)) {
          f.vars.__rfp = tool;
          ask(s, { player: f.player, kind: 'yesno', prompt: 'Ignore the results of those coin flips and flip them again?', min: 1, max: 1, labels: ['Yes', 'No'] }, 'bool');
          return 'wait';
        }
      }
      return 'next';
    }
    case 'effect': {
      const { start, until } = durationTurns(s, f.player, st.duration);
      const later = start > s.turn ? { start } : {};
      const lastsCheckup = st.duration === 'throughMyNextTurn' ? { throughCheckup: true } : {};
      if (st.on) {
        const t = resolveSlot(s, e, st.on);
        if (!t) return 'next';
        if (f.kind === 'attack' && ownerOf(s, t) !== f.player && effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
        s.effects.push({
          static: st.static,
          slot: t.id,
          player: ownerOf(s, t),
          until,
          ...later,
          ...lastsCheckup,
          fromAttack: f.kind === 'attack',
          src: f.src,
          since: s.turn,
          filter: st.filter,
          // A reacting effect carries its program, compiled once per op instance (as `delay` does), and who controls it.
          ...(st.static.k === 'react' ? { code: ensureCode(env.ctx, `${f.code}@${f.pc}`, st.static.program), by: f.player, from: f.slot } : {}),
        });
      } else {
        s.effects.push({
          static: st.static,
          slot: -1,
          player: side(e, st.onPlayer),
          until,
          ...later,
          ...lastsCheckup,
          fromAttack: f.kind === 'attack',
          src: f.src,
          filter: st.filter,
          ...(st.scope ? { scope: st.scope } : {}), // lane:metal
          ...(st.static.k === 'extraPrize' && st.static.thisAttack && s.attackBy !== undefined ? { atk: { by: s.attackBy, use: s.attackUses ?? 0 } } : {}),
        });
      }
      return 'next';
    }
    case 'delay': {
      if (st.global) {
        // Not tied to a Pokémon: it runs at the end of the turn whatever happens to the board.
        const gturn = durationTurns(s, f.player, st.duration).until;
        const gcode = ensureCode(env.ctx, `${f.code}@${f.pc}`, st.program);
        s.delayed = [...(s.delayed ?? []), { code: gcode, slot: 0, player: f.player, src: f.src, from: f.slot, turn: gturn, fromAttack: false }];
        return 'next';
      }
      const t = resolveSlot(s, e, st.on ?? 'defender');
      if (!t) return 'next';
      if (f.kind === 'attack' && ownerOf(s, t) !== f.player && effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
      const turn = durationTurns(s, f.player, st.duration).until;
      // One compiled copy per op instance: the frame's program and position name it.
      const code = ensureCode(env.ctx, `${f.code}@${f.pc}`, st.program);
      s.delayed = [...(s.delayed ?? []), { code, slot: t.id, player: f.player, src: f.src, from: f.slot, turn, fromAttack: f.kind === 'attack' }];
      return 'next';
    }
    case 'knockOut': {
      const t = resolveSlot(s, e, st.target);
      if (!t) return 'next';
      if (trainerBlocked(env, s, f, t)) return 'next';
      if (f.kind === 'attack' && ownerOf(s, t) !== f.player && effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
      t.damage = Math.max(t.damage, maxHp(env, s, t));
      return 'next';
    }
    case 'useAttackOf':
      return useAttackOf(env, s, f, st.card);
    case 'custom': {
      const fn = CUSTOMS[st.fn];
      if (!fn) throw new Error(`unknown custom effect ${st.fn}`);
      const guard = env.ctx.handLock ? guardHand(env, s) : null;
      const r = fn(env, s, f, st.args ?? {}, takeAnswer(f));
      if (guard) enforceHandGuard(s, guard);
      return r;
    }
    case 'end':
      return 'pop';
    case 'look': {
      // The top n cards of a deck, seen and left where they are; the ones matching the filter are kept for the program.
      const w = side(e, st.who);
      const deck = s.p[w].deck;
      const n = Math.max(0, evalExpr(env, s, e, st.n));
      f.vars[st.as] = deck
        .slice(Math.max(0, deck.length - n))
        .reverse()
        .filter((c) => cardMatches(env, c, st.filter));
      if (w === f.player) s.p[w].knownTop = Math.max(s.p[w].knownTop, Math.min(n, deck.length));
      return 'next';
    }
    case 'turnPrizeUp': {
      // One of the player's face-down Prize cards (a pick among cards nobody can see: the first) is turned face up for good.
      const ps = s.p[side(e, st.who)];
      const up = (ps.prizesUp ?? []).filter((c) => ps.prizes.includes(c));
      const c = ps.prizes.find((x) => !up.includes(x));
      if (c !== undefined) ps.prizesUp = [...up, c];
      if (st.as) f.vars[st.as] = c === undefined ? [] : [c];
      return 'next';
    }
    case 'endTurn':
      // As after an attack (the flow ends the turn once Knock Outs are resolved), without an attack: nothing was damaged by one.
      if (!s.attacked) {
        s.attacked = true;
        s.attackHits = [];
      }
      s.noMoreAttacks = true; // not even a second attack (Festival Lead)
      return 'next';
    default:
      throw new Error(`step ${(st as Step).op} must be compiled`);
  }
}

/** A player's board as it was before a custom effect, while their Pokémon in play and the cards attached can't be put into their hand. */
interface HandGuard {
  p: Player;
  slots: Slot[];
  active: number;
  hand: Set<number>;
  discard: Set<number>;
}

function guardHand(env: Env, s: GameState): HandGuard[] | null {
  const all = statics(env, s);
  const out: HandGuard[] = [];
  for (const p of [0, 1] as Player[]) {
    if (!returnToHandBlocked(env, s, p, all)) continue;
    const ps = s.p[p];
    out.push({
      p,
      slots: allSlots(ps).map((sl) => ({ ...sl, cards: sl.cards.slice(), energy: sl.energy.slice(), tools: sl.tools.slice(), usedAbilities: sl.usedAbilities.slice() })),
      active: ps.active?.id ?? 0,
      hand: new Set(ps.hand),
      discard: new Set(ps.discard),
    });
  }
  return out.length ? out : null;
}

/**
 * Milotic's Mentally Calm: "Your opponent's Pokémon in play and all attached cards can't be put into your opponent's hand." A custom
 * effect (they are written without knowing about it) that put such a card into the hand has it taken back to where it was: the effect is
 * still used, but the card stays (TPCi Rules Team 2026-06-04, ruling 2370: the attack's bonus damage is still got; 2025-04-03, ruling 2129:
 * all cards stay attached to the Pokémon that did not go to the hand).
 */
function enforceHandGuard(s: GameState, guards: HandGuard[]): void {
  for (const g of guards) {
    const ps = s.p[g.p];
    for (const snap of g.slots) {
      const cards = [...snap.cards, ...snap.energy, ...snap.tools];
      if (!cards.some((c) => !g.hand.has(c) && ps.hand.includes(c))) continue;
      const cur = allSlots(ps).find((x) => x.id === snap.id);
      if (cur) {
        for (const c of cards) {
          if (g.hand.has(c) || !ps.hand.includes(c)) continue;
          removeFrom(ps.hand, c);
          removeFrom(ps.revealed, c);
          if (snap.cards.includes(c)) cur.cards.splice(Math.min(snap.cards.indexOf(c), cur.cards.length), 0, c);
          else if (snap.energy.includes(c)) cur.energy.push(c);
          else cur.tools.push(c);
        }
        continue;
      }
      // The whole Pokémon left play: it stays, with everything that went with it.
      for (const c of cards) {
        removeFrom(ps.hand, c);
        removeFrom(ps.revealed, c);
        if (!g.discard.has(c)) removeFrom(ps.discard, c);
      }
      if (g.active === snap.id && !ps.active) ps.active = snap;
      else ps.bench.push(snap);
    }
  }
}

/** Is the first `move` of the cards in variable `as`, further on in this frame's program, one into the hand or the deck? */
function movesToHandOrDeck(env: Env, f: Frame, as: string): boolean {
  const code = codeOf(env.ctx, f.code);
  for (let i = f.pc + 1; i < code.length; i++) {
    const op = code[i] as Op;
    if (op.o === 'step' && op.s.op === 'move' && op.s.cards === as) return op.s.to === 'hand' || op.s.to === 'deck' || op.s.to === 'deckTop' || op.s.to === 'deckBottom';
  }
  return false;
}

/**
 * Does the program this frame runs flip coins at one place only, once (one `flip` op, not in a loop)? Backtrack Badge's "flip those coins
 * again" is then exactly this flip step flipped again.
 */
function flipsOnce(env: Env, f: Frame): boolean {
  const code = codeOf(env.ctx, f.code);
  let n = 0;
  for (let i = 0; i < code.length; i++) {
    const op = code[i] as Op;
    if (op.o === 'step' && op.s.op === 'flip') n++;
    if (op.o === 'jmp' && op.to <= f.pc && i > f.pc) return false; // a loop around this flip
  }
  return n === 1;
}

/**
 * Apply a Special Condition; `turn` (the current turn) records when Paralysis began, for the Checkup. `counters`: the damage
 * counters Poison places at each Checkup (instead of 1) or a failed Confusion flip places (instead of 3). Applying the condition
 * again replaces the amount, a plain application restores the usual one (TPCi 2013-02-21, ruling 1044).
 */
export function applyCondition(t: Slot, c: SpecialCondition, turn?: number, counters?: number): void {
  const bit = COND_BITS[c];
  if (bit & ROTATION) t.cond = (t.cond & ~ROTATION) | bit;
  else t.cond |= bit;
  if (bit === PARALYZED && turn !== undefined) t.paralyzedTurn = turn;
  if (bit === POISONED) {
    if (counters !== undefined && counters !== 1) t.poisonCounters = counters;
    else delete t.poisonCounters;
  }
  if (bit === BURNED) {
    if (counters !== undefined && counters !== 2) t.burnCounters = counters;
    else delete t.burnCounters;
  }
  if (bit === CONFUSED) {
    if (counters !== undefined && counters !== 3) t.confusionCounters = counters;
    else delete t.confusionCounters;
  }
}

function chooseCards(env: Env, s: GameState, f: Frame, st: Extract<Step, { op: 'chooseCards' }>): R {
  const e = ec(f);
  const owner = side(e, st.who);
  const chooser = side(e, st.chooser);
  const zone = cardsInZone(s, owner, st.from);
  if (st.from === 'deck' && owner === chooser) s.p[owner].prizesKnown = true;

  if (st.oneEach) {
    // Sequential: one optional pick per filter (Secret Box).
    const k = (f.vars.__k as number) ?? 0;
    const acc = (f.vars.__acc as number[]) ?? [];
    const a = takeAnswer(f);
    if (a !== undefined) {
      acc.push(...(a as number[]));
      f.vars.__acc = acc;
      f.vars.__k = k + 1;
      return 'wait';
    }
    if (k >= st.oneEach.length) {
      f.vars[st.as] = acc;
      if (st.from === 'deck') emit(env, { type: 'search', player: chooser, found: acc.slice() });
      delete f.vars.__k;
      delete f.vars.__acc;
      if (st.reveal) f.vars.__revealed = [...((f.vars.__revealed as number[]) ?? []), ...acc];
      return 'next';
    }
    const flt = st.oneEach[k] as Filter;
    const opts = zone.filter((c) => !acc.includes(c) && cardMatches(env, c, flt));
    f.vars.__acc = acc;
    if (!opts.length) {
      f.vars.__k = k + 1;
      return 'wait';
    }
    ask(s, { player: chooser, kind: 'cards', prompt: st.prompt ?? 'Choose a card (or none)', min: 0, max: 1, values: opts }, 'cards');
    return 'wait';
  }

  const a = takeAnswer(f);
  if (a !== undefined) {
    f.vars[st.as] = a as number[];
    if (st.from === 'deck') emit(env, { type: 'search', player: chooser, found: (a as number[]).slice() });
    if (st.reveal) f.vars.__revealed = [...((f.vars.__revealed as number[]) ?? []), ...(a as number[])];
    return 'next';
  }
  // Cards that "can't be put into your hand or deck from the discard pile" are not offered when the chosen cards are about to be put there.
  const noRecover = st.from === 'discard' && movesToHandOrDeck(env, f, st.as);
  // A Special Energy that provides its Energy only while attached is no type of Energy in the hand, deck or discard pile (#668).
  const offPlayType = !!st.filter?.providesType;
  const opts = zone.filter(
    (c) =>
      (!st.others || c !== f.src) &&
      cardMatches(env, c, st.filter) &&
      !(noRecover && def(env.ctx, c).script?.noRecoverFromDiscard) &&
      !(offPlayType && def(env.ctx, c).typeOnlyAttached),
  );
  const [least, max] = bounds(opts.length, evalExpr(env, s, e, st.min), evalExpr(env, s, e, st.max));
  // Searching your own (hidden) deck for cards of a kind ("a Basic Pokémon", "an Energy card"), you may find none even when one is
  // there, since nobody can check (Compendium #903). A search for any card at all has no such way out.
  const failToFind = st.from === 'deck' && owner === chooser && !!st.filter && Object.values(st.filter).some((v) => v !== undefined);
  const min = failToFind ? 0 : least;
  if (forced(opts.length, min, max)) {
    const pick = max === 0 ? [] : opts.slice(0, max);
    f.vars[st.as] = pick;
    if (st.from === 'deck') emit(env, { type: 'search', player: chooser, found: pick.slice() });
    if (st.reveal) f.vars.__revealed = [...((f.vars.__revealed as number[]) ?? []), ...pick];
    return 'next';
  }
  ask(s, { player: chooser, kind: 'cards', prompt: st.prompt ?? 'Choose cards', min, max, values: opts }, 'cards');
  return 'wait';
}

function discardEnergy(env: Env, s: GameState, f: Frame, st: Extract<Step, { op: 'discardEnergy' }>): R {
  const e = ec(f);
  const t = resolveSlot(s, e, st.from);
  if (!t) return 'next';
  const owner = ownerOf(s, t);
  if (trainerBlocked(env, s, f, t)) return 'next';
  if (f.kind === 'attack' && owner !== f.player && effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
  // "{M} Energy" attached: what each card provides on THIS Pokémon (Neo Upper Energy only on a Stage 2).
  const pt = st.filter?.providesType;
  const rest = pt ? { ...st.filter, providesType: undefined } : st.filter;
  const pool = t.energy.filter((c) => cardMatches(env, c, rest) && (!pt || cardUnits(env, t, c, s).some((u) => unitFits(u, pt))));
  let chosen: number[];
  if (st.count === 'all') chosen = pool;
  else if (st.units && pool.some((c) => cardUnits(env, t, c, s).length !== 1)) {
    // Paying in units with a multi-unit card attached: offer each covering set (see `unitCovers`).
    const n = evalExpr(env, s, e, st.count);
    const covers = unitCovers(env, s, t, pool, n, st.upToCards);
    const a = takeAnswer(f);
    if (a !== undefined) chosen = covers[(a as number[])[0] ?? 0] ?? pool;
    else if (covers.length <= 1) chosen = covers[0] ?? pool; // none covers it: discard what there is
    else {
      const labels = covers.map((set) => `Discard ${set.map((c) => def(env.ctx, c).name).join(' + ')}`);
      ask(s, { player: f.player, kind: 'option', prompt: `Discard Energy to pay ${n}`, min: 1, max: 1, labels }, 'index');
      return 'wait';
    }
  } else {
    const n = evalExpr(env, s, e, st.count);
    const a = takeAnswer(f);
    if (a !== undefined) chosen = a as number[];
    else if (n <= 0) chosen = []; // nothing to pay (a Retreat Cost of 0): no question
    else if (pool.length <= n) chosen = pool;
    else {
      // Dedupe identical Energy for the decision but keep instance ids.
      ask(s, { player: f.player, kind: 'cards', prompt: `Discard ${n} Energy`, min: n, max: n, values: pool }, 'cards');
      return 'wait';
    }
  }
  for (const c of chosen) removeFrom(t.energy, c);
  s.p[owner].discard.push(...chosen);
  if (chosen.length) emit(env, { type: 'discard', player: owner, cards: chosen });
  if (st.as) f.vars[st.as] = chosen;
  // Boomerang-style Energy: discarded by an effect of its own Pokémon's attack → reattach after attacking.
  if (f.kind === 'attack' && owner === f.player && t.id === f.slot) {
    const back = chosen.filter((c) => def(env.ctx, c).script?.reattachAfterOwnAttack);
    if (back.length) {
      const root = s.stack.find((x) => x.kind === 'attack' && x.slot === f.slot) ?? f;
      root.vars.__reattach = [...((root.vars.__reattach as number[]) ?? []), ...back];
    }
    // Nitro Fire Energy: only when the Pokémon that used the attack is of the kind the card names.
    const toHand = chosen.filter((c) => {
      const h = def(env.ctx, c).script?.handAfterOwnAttack;
      return !!h && slotMatches(env, t, h.holder, true, s);
    });
    if (toHand.length) {
      const root = s.stack.find((x) => x.kind === 'attack' && x.slot === f.slot) ?? f;
      root.vars.__toHand = [...((root.vars.__toHand as number[]) ?? []), ...toHand];
    }
  }
  return 'next';
}

/**
 * Every way to pay `n` Energy units from `pool` (cards attached to `t`) with no card to spare:
 * the set covers `n`, and dropping any one card would not. With `upToCards` (a Retreat Cost) it is
 * every set that covers `n` with no more cards than `n` (Compendium #2127). Identical cards are
 * interchangeable, so each distinct set appears once. Order = the default choice first: fewest
 * Special Energy given up, then least overpaid, then fewest cards.
 */
function unitCovers(env: Env, s: GameState, t: Slot, pool: number[], n: number, upToCards = false): number[][] {
  const groups = new Map<number, { units: number; special: boolean; cards: number[] }>();
  for (const c of pool) {
    const d = def(env.ctx, c);
    let g = groups.get(d.idx);
    if (!g) groups.set(d.idx, (g = { units: cardUnits(env, t, c, s).length, special: !d.basicEnergy, cards: [] }));
    g.cards.push(c);
  }
  const gs = [...groups.values()];
  const pick = gs.map(() => 0);
  const out: { set: number[]; special: number; over: number }[] = [];
  const rec = (i: number, sum: number): void => {
    if (i === gs.length) {
      if (sum < n) return;
      if (upToCards) {
        if (pick.reduce((a, k) => a + k, 0) > n) return; // more cards than the cost
      } else {
        let least = Infinity;
        gs.forEach((g, j) => {
          if (pick[j]) least = Math.min(least, g.units);
        });
        if (sum - least >= n) return; // a card to spare
      }
      const set = gs.flatMap((g, j) => g.cards.slice(0, pick[j]));
      out.push({ set, special: gs.reduce((a, g, j) => a + (g.special ? (pick[j] as number) : 0), 0), over: sum - n });
      return;
    }
    const g = gs[i] as (typeof gs)[number];
    for (let k = 0; k <= g.cards.length; k++) {
      pick[i] = k;
      rec(i + 1, sum + k * g.units);
    }
    pick[i] = 0;
  };
  rec(0, 0);
  out.sort((x, y) => x.special - y.special || x.over - y.over || x.set.length - y.set.length);
  return out.map((x) => x.set);
}

function switchStep(env: Env, s: GameState, f: Frame, st: Extract<Step, { op: 'switch' }>): R {
  const e = ec(f);
  const who = side(e, st.who);
  const ps = s.p[who];
  if (!ps.active || !ps.bench.length) return 'next';
  // Switching OUT the opponent's Active Pokémon ("Your opponent chooses the new Active Pokémon") is an effect on it, so its protection
  // stops the switch. Switching IN a Benched Pokémon (a gust: Heave-Ho Catcher, Drag Off) acts on that Benched Pokémon instead (ruling
  // 2155, checked below): an Active Pokémon protected from effects of attacks or Abilities (Hide 'n' Sneak) can still be pulled away.
  const switchOut = st.chooser === 'opp' && !st.with;
  if ((f.kind === 'attack' || f.kind === 'ability') && who !== f.player && switchOut && effectsPrevented(env, s, ps.active, f.player, f.kind)) {
    return 'next';
  }
  // (No check on the Active Pokémon for a Trainer that switches IN a Benched Pokémon: it targets that Benched Pokémon, so only it is
  // checked below -- TPCi Rules Team 2025-05-29, ruling 2154, Team Rocket's Giovanni and Cetitan ex. A Trainer that switches OUT the
  // opponent's Active Pokémon, "(Your opponent chooses the new Active Pokémon.)", is an effect on that Active Pokémon: if it is
  // protected from the card, nothing happens -- Compendium #1823.)
  if (f.kind === 'trainer' && who !== f.player && st.chooser === 'opp' && !st.with && trainerBlocked(env, s, f, ps.active)) return 'next';
  let target: Slot | undefined;
  if (st.with) {
    target = resolveSlot(s, e, st.with) ?? undefined;
  } else {
    const a = takeAnswer(f);
    if (a !== undefined) target = ps.bench.find((b) => b.id === (a as number[])[0]);
    else if (ps.bench.length === 1) target = ps.bench[0];
    else {
      const chooser = st.chooser ? side(e, st.chooser) : f.player;
      ask(
        s,
        { player: chooser, kind: 'slots', prompt: 'Choose the new Active Pokémon', min: 1, max: 1, values: ps.bench.map((b) => b.id) },
        'slots',
      );
      return 'wait';
    }
  }
  if (!target || !ps.bench.includes(target)) return 'next';
  if (trainerBlocked(env, s, f, target)) return 'next'; // ...or the Pokémon that would come up is
  // ...and so is the Benched Pokémon that would be switched in: an attack or Ability can't bring a Pokémon that is protected from its
  // effects into the Active Spot (TPCi Rules Team 2025-05-29, ruling 2155: Drag Off and Misty's Magikarp's So Submerged -- the switch
  // does not happen, so there is no new Active Pokémon to damage either). That is when the attacking player picks the Pokémon: when the
  // Pokémon's own player chooses ("Your opponent chooses the new Active Pokémon"), the attack is not doing anything to the one they pick.
  const picked = !!st.with || st.chooser !== 'opp';
  if ((f.kind === 'attack' || f.kind === 'ability') && who !== f.player && picked && effectsPrevented(env, s, target, f.player, f.kind)) {
    f.vars.__switchFailed = true;
    return 'next';
  }
  swapActive(env, s, who, target, f.code === '__retreat');
  return 'next';
}

/** Move the Active to the Bench and `target` to the Active Spot; clears conditions and attack effects. */
export function swapActive(env: Env, s: GameState, who: Player, target: Slot, retreat = false): void {
  const ps = s.p[who];
  const old = ps.active;
  ps.bench = ps.bench.filter((b) => b !== target);
  if (old) {
    old.cond = 0;
    clearAttackEffects(s, old.id);
    ps.bench.push(old);
  }
  ps.active = target;
  target.movedActiveTurn = s.turn;
  emit(env, { type: retreat ? 'retreat' : 'switch', player: who, from: old?.id ?? 0, to: target.id });
  if (old && s.phase === 'main') {
    // The old Active moved to the Bench: its own "moves from the Active Spot to your Bench" Abilities, and the other side's
    // "whenever your opponent's Active Pokémon moves to the Bench during their turn" Abilities (only in the mover's own turn).
    queueTriggers(env, s, old, who, 'movedToBench');
    if (s.current === who) {
      for (const w of allSlots(s.p[opp(who)])) queueTriggers(env, s, w, opp(who), 'oppActiveMovedToBench', { __target: old.id });
    }
  }
  queueMovedToActive(env, s, target, who);
}

/**
 * A Pokémon of `owner` moved from the Bench to the Active Spot (a switch, a retreat or a promotion): its own "when this Pokémon moves
 * from your Bench to the Active Spot" Abilities, and those of the owner's Pokémon that watch for another of them to (`__target`).
 */
export function queueMovedToActive(env: Env, s: GameState, moved: Slot, owner: Player): void {
  if (s.phase !== 'main') return;
  queueTriggers(env, s, moved, owner, 'movedToActive');
  for (const w of allSlots(s.p[owner])) queueTriggers(env, s, w, owner, 'allyMovedToActive', { __target: moved.id });
}

function useAttackOf(env: Env, s: GameState, f: Frame, cardVar: string): R {
  const v = f.vars[cardVar];
  const card = Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined;
  if (card === undefined) return 'next';
  const d = def(env.ctx, card);
  if (d.kind !== 'pokemon' || !d.attacks.length) return 'next';
  const a = takeAnswer(f);
  let idx: number;
  if (a !== undefined) idx = (a as number[])[0] ?? 0;
  else if (d.attacks.length === 1) idx = 0;
  else {
    ask(
      s,
      {
        player: f.player,
        kind: 'option',
        prompt: `Use which of ${d.name}'s attacks?`,
        min: 1,
        max: 1,
        labels: d.attacks.map((x) => x.name),
      },
      'index',
    );
    return 'wait';
  }
  const atk = d.attacks[idx];
  if (!atk) return 'next';
  f.pc++; // resume after this op when the copied attack's frame finishes
  s.stack.push({
    code: `${atk.code}:copy`,
    pc: 0,
    vars: { __atkDef: d.idx, __atkIdx: idx, __def: f.vars.__def ?? 0 },
    player: f.player,
    src: card,
    slot: f.slot,
    kind: 'attack',
  });
  emit(env, { type: 'attack', player: f.player, slot: f.slot, name: atk.name });
  return 'wait';
}

export { allSlots, attackCost, opp };
