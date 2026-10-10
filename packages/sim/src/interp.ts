/**
 * The effect interpreter. Runs the top frame of `s.stack` op by op until it
 * needs a decision (sets `s.pending` and returns) or the stack is empty.
 *
 * A decision is answered by storing the answer in the frame's `__a` variable
 * and re-running the same op, which consumes it -- so an op is the unit of
 * atomicity and every pause point is just (frame, pc).
 */
import { codeOf, def, type Env } from './context.js';
import type { Op } from './compile.js';
import type { CardZone, DamageIgnore, Dest, Filter, SlotRef, SlotZone, SpecialCondition, Step } from './dsl.js';
import { cardMatches, evalCond, evalExpr, resolveSlot, side, slotMatches, slotsIn, type EvalCtx } from './eval.js';
import {
  attackCost,
  damageIn,
  damageOut,
  damagePrevented,
  countersPrevented, // lane:darkrai
  effectsPrevented,
  hasNoAbilities,
  maxHp,
  ownerOf,
  statics,
  toolsDisabled, // lane:fighting
  weaknessOf,
} from './query.js';
import {
  allSlots,
  draw,
  emit,
  findSlot,
  flipCoin,
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
  if (!slot || !(slot.cond & CONFUSED)) return 'next';
  if (flipCoin(env, s, f.player)) return 'next';
  // Tails: put 3 damage counters on the attacker and the attack ends.
  slot.damage += 30;
  emit(env, { type: 'counters', player: f.player, slot: slot.id, n: 3 });
  return 'pop';
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

function targetsOf(env: Env, s: GameState, f: Frame, to: SlotRef | { each: SlotZone; filter?: Filter } | { v: string }): Slot[] {
  if (typeof to === 'object' && 'each' in to) {
    return slotsIn(s, f.player, to.each).filter((sl) => slotMatches(env, sl, to.filter));
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
  const attacker = findSlot(s, f.slot)?.slot;
  const all = statics(env, s);
  const atkTypes = attacker ? def(env.ctx, topCard(attacker)).types : [];
  for (const target of targetsOf(env, s, f, to)) {
    const owner = ownerOf(s, target);
    const isActive = s.p[owner].active === target;
    // lane:fighting — "isn't affected by any effects on your opponent's Active Pokémon"
    const noDefEffects = !!ignore?.defenderEffects && isActive && owner !== f.player;
    let dmg = base;
    if (dmg > 0 && attacker && owner !== f.player && isActive) dmg += damageOut(env, s, attacker, target, all);
    if (dmg > 0 && isActive && owner !== f.player) {
      const w = noDefEffects ? def(env.ctx, topCard(target)).weakness : weaknessOf(env, s, target, all);
      if (!ignore?.weakness && w && atkTypes.includes(w)) dmg *= 2;
      const r = def(env.ctx, topCard(target)).resistance;
      if (!ignore?.resistance && r && atkTypes.includes(r.type)) dmg -= r.amount;
    }
    if (dmg > 0 && !noDefEffects) dmg += damageIn(env, s, target, all, f.player); // lane:metal (fromOpp) + lane:fighting (ignore)
    if (dmg < 0) dmg = 0;
    if (dmg > 0 && !noDefEffects && damagePrevented(env, s, target, f.player, all, attacker ?? undefined)) dmg = 0; // lane:ghost (attacker)
    if (dmg <= 0) continue;
    target.damage += dmg;
    // lane:fighting — remember who this attack damaged (Legacy Energy: "Knocked Out by damage from an attack")
    if (f.kind === 'attack' && owner !== f.player) s.attackHits = [...(s.attackHits ?? []), target.id];
    emit(env, { type: 'damage', player: owner, slot: target.id, amount: dmg, bySlot: f.slot });
    if (owner !== f.player && isActive) queueTriggers(env, s, target, owner, 'damagedByAttackActive');
  }
  return 'next';
}

/** Queue triggers on a Pokémon (its Abilities) and on its attached Tools. */
export function queueTriggers(
  env: Env,
  s: GameState,
  slot: Slot,
  owner: Player,
  // lane:misc — 'checkup' and 'endOfTurn' added; attached Energy are trigger sources too (Ignition Energy).
  on: 'damagedByAttackActive' | 'knockedOutByAttack' | 'playToBench' | 'evolveFromHand' | 'checkup' | 'endOfTurn' | 'oppAttachFromHand', // lane:ghost
  /** lane:ghost — initial frame variables (e.g. `__target` for oppAttachFromHand). */
  vars?: Record<string, Val>,
): void {
  const sources = [topCard(slot), ...(toolsDisabled(env, s) ? [] : slot.tools), ...slot.energy]; // lane:misc energy triggers; lane:fighting Jamming Tower
  const noAb = hasNoAbilities(env, s, slot);
  for (const c of sources) {
    const d = def(env.ctx, c);
    if (d.coverage !== 'full') continue;
    const isPokemon = c === topCard(slot);
    if (isPokemon && noAb) continue;
    for (const t of d.triggers) {
      if (t.t.on !== on) continue;
      const frame: Frame = {
        code: t.code,
        pc: 0,
        vars: { ...vars }, // lane:ghost
        player: owner,
        src: c,
        slot: slot.id,
        kind: isPokemon ? 'ability' : slot.tools.includes(c) ? 'tool' : 'energy',
      };
      if (t.t.when && !evalCond(env, s, ec(frame), t.t.when)) continue;
      if (t.t.optional) frame.vars.__optional = true;
      s.queued.push(frame);
    }
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
 * lane:ghost — `owner` attached an Energy card from their hand to `target`: fire the
 * opponent's "whenever your opponent attaches an Energy card from their hand" Abilities.
 */
export function queueOppAttachTriggers(env: Env, s: GameState, owner: Player, target: Slot): void {
  const watcher = opp(owner);
  for (const w of allSlots(s.p[watcher])) queueTriggers(env, s, w, watcher, 'oppAttachFromHand', { __target: target.id });
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function cardsInZone(s: GameState, p: Player, z: CardZone): number[] {
  return s.p[p][z];
}

function moveCards(env: Env, s: GameState, f: Frame, cards: number[], to: Dest, who: Player): number[] {
  const ps = s.p[who];
  const moved: number[] = [];
  const revealed = (f.vars.__revealed as number[] | undefined) ?? [];
  for (const c of cards) {
    const owner = env.ctx.owner[c] as Player;
    const ops = s.p[owner];
    if (to === 'bench') {
      const d = def(env.ctx, c);
      const asBasic = d.kind === 'trainer' && !!d.script?.fix?.playAsBasic; // lane:ghost (Antique fossils)
      if ((d.kind !== 'pokemon' && !asBasic) || d.stage !== 0 || ops.bench.length >= 5) continue;
      if (!takeFromZones(ops, c)) continue;
      const sl = newSlot(s, c);
      ops.bench.push(sl);
      emit(env, { type: 'play_to_bench', player: owner, card: c, slot: sl.id });
      queueStadiumBench(env, s, sl, owner); // lane:misc
      moved.push(c);
      continue;
    }
    if (!takeFromZones(ops, c) && !removeFrom(s.limbo, c)) continue;
    moved.push(c);
    switch (to) {
      case 'hand':
        ops.hand.push(c);
        if (revealed.includes(c)) ops.revealed.push(c);
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
      let opts = slotsIn(s, f.player, st.from).filter((sl) => slotMatches(env, sl, st.filter));
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
      const moved = moveCards(env, s, f, cards, st.to, who);
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
        if ((f.kind === 'attack' || f.kind === 'ability') && effectsPrevented(env, s, t, f.player, kind, all)) continue;
        if ((f.kind === 'attack' || f.kind === 'ability') && countersPrevented(env, s, t, f.player, kind, all)) continue; // lane:darkrai
        t.damage += n * 10;
        emit(env, { type: 'counters', player: ownerOf(s, t), slot: t.id, n });
      }
      return 'next';
    }
    case 'heal': {
      const t = resolveSlot(s, e, st.to);
      if (t) t.damage = Math.max(0, t.damage - evalExpr(env, s, e, st.amount));
      return 'next';
    }
    case 'condition': {
      const t = resolveSlot(s, e, st.to);
      if (!t) return 'next';
      if ((f.kind === 'attack' || f.kind === 'ability') && effectsPrevented(env, s, t, f.player, f.kind)) return 'next';
      if (def(env.ctx, topCard(t)).script?.fix?.playAsBasic?.noConditions) return 'next'; // lane:ghost
      applyCondition(t, st.cond);
      emit(env, { type: 'condition', player: ownerOf(s, t), slot: t.id, cond: st.cond });
      return 'next';
    }
    case 'switch':
      return switchStep(env, s, f, st);
    case 'flip': {
      let heads = 0;
      if (st.n === 'untilTails') {
        // Bounded so a forced-heads replay can't loop forever.
        for (let i = 0; i < 100 && flipCoin(env, s, f.player); i++) heads++;
      } else {
        const n = evalExpr(env, s, e, st.n);
        for (let i = 0; i < n; i++) if (flipCoin(env, s, f.player)) heads++;
      }
      f.vars[st.as] = heads;
      return 'next';
    }
    case 'effect': {
      const until = st.duration === 'thisTurn' ? s.turn : st.duration === 'oppNextTurn' ? s.turn + 1 : s.turn + 2;
      if (st.on) {
        const t = resolveSlot(s, e, st.on);
        if (!t) return 'next';
        if (f.kind === 'attack' && ownerOf(s, t) !== f.player && effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
        s.effects.push({
          static: st.static,
          slot: t.id,
          player: ownerOf(s, t),
          until,
          fromAttack: f.kind === 'attack',
          src: f.src,
          filter: st.filter,
        });
      } else {
        s.effects.push({
          static: st.static,
          slot: -1,
          player: side(e, st.onPlayer),
          until,
          fromAttack: f.kind === 'attack',
          src: f.src,
          filter: st.filter,
          ...(st.scope ? { scope: st.scope } : {}), // lane:metal
        });
      }
      return 'next';
    }
    case 'knockOut': {
      const t = resolveSlot(s, e, st.target);
      if (!t) return 'next';
      if (f.kind === 'attack' && ownerOf(s, t) !== f.player && effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
      t.damage = Math.max(t.damage, maxHp(env, s, t));
      return 'next';
    }
    case 'useAttackOf':
      return useAttackOf(env, s, f, st.card);
    case 'custom': {
      const fn = CUSTOMS[st.fn];
      if (!fn) throw new Error(`unknown custom effect ${st.fn}`);
      return fn(env, s, f, st.args ?? {}, takeAnswer(f));
    }
    case 'end':
      return 'pop';
    default:
      throw new Error(`step ${(st as Step).op} must be compiled`);
  }
}

export function applyCondition(t: Slot, c: SpecialCondition): void {
  const bit = COND_BITS[c];
  if (bit & ROTATION) t.cond = (t.cond & ~ROTATION) | bit;
  else t.cond |= bit;
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
    if (st.reveal) f.vars.__revealed = [...((f.vars.__revealed as number[]) ?? []), ...(a as number[])];
    return 'next';
  }
  const opts = zone.filter((c) => (!st.others || c !== f.src) && cardMatches(env, c, st.filter));
  const [min, max] = bounds(opts.length, evalExpr(env, s, e, st.min), evalExpr(env, s, e, st.max));
  if (forced(opts.length, min, max)) {
    const pick = max === 0 ? [] : opts.slice(0, max);
    f.vars[st.as] = pick;
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
  if (f.kind === 'attack' && owner !== f.player && effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
  const pool = t.energy.filter((c) => cardMatches(env, c, st.filter));
  let chosen: number[];
  if (st.count === 'all') chosen = pool;
  else {
    const n = evalExpr(env, s, e, st.count);
    const a = takeAnswer(f);
    if (a !== undefined) chosen = a as number[];
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
  }
  return 'next';
}

function switchStep(env: Env, s: GameState, f: Frame, st: Extract<Step, { op: 'switch' }>): R {
  const e = ec(f);
  const who = side(e, st.who);
  const ps = s.p[who];
  if (!ps.active || !ps.bench.length) return 'next';
  if ((f.kind === 'attack' || f.kind === 'ability') && who !== f.player && effectsPrevented(env, s, ps.active, f.player, f.kind)) {
    return 'next';
  }
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
  swapActive(env, s, who, target);
  return 'next';
}

/** Move the Active to the Bench and `target` to the Active Spot; clears conditions and attack effects. */
export function swapActive(env: Env, s: GameState, who: Player, target: Slot): void {
  const ps = s.p[who];
  const old = ps.active;
  ps.bench = ps.bench.filter((b) => b !== target);
  if (old) {
    old.cond = 0;
    s.effects = s.effects.filter((x) => !(x.slot === old.id && x.fromAttack));
    ps.bench.push(old);
  }
  ps.active = target;
  emit(env, { type: 'switch', player: who, from: old?.id ?? 0, to: target.id });
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
