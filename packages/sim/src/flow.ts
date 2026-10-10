/**
 * The rules kernel: setup, the turn, legal actions, Knock Outs and Prize cards,
 * Pokémon Checkup and winning. Page numbers cite the Pokémon TCG Rulebook
 * (last updated September 2026) via the battle-sim plan's rules table.
 *
 * Public surface: `startGame`, `submit`, `legalActions`. The engine is one
 * function in spirit: (state, choice) → state; `submit` mutates in place, so
 * callers clone first when they need the old state (search does).
 */
import { def, type Env } from './context.js';
import { evalCond } from './eval.js';
import { applyCondition, queueOppAttachTriggers, queueStadiumBench, queueTriggers, run, swapActive } from './interp.js';
import {
  abilityLost,
  extraPrizeFor,
  attackBlocked, // lane:fighting
  attackCost,
  canPay,
  cantAttack,
  cantRetreat,
  effectsPrevented,
  energyUnits,
  hasNoAbilities,
  itemLocked,
  maxHp,
  retreatCost,
  statics,
} from './query.js';
import {
  allSlots,
  draw,
  emit,
  flipCoin,
  newSlot,
  opp,
  removeFrom,
  shuffleDeck,
  slotCards,
  topCard,
} from './state.js';
import {
  ASLEEP,
  BURNED,
  PARALYZED,
  POISONED,
  type Action,
  type Decision,
  type Frame,
  type GameState,
  type Player,
  type Slot,
} from './types.js';

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Begin a game: runs setup up to the first decision. */
export function startGame(env: Env, s: GameState): void {
  s.phase = 'setup';
  s.step = 'coin';
  advance(env, s);
}

/** Answer the pending decision with option indexes, then run to the next decision. */
export function submit(env: Env, s: GameState, choice: number[]): void {
  const pend = s.pending;
  if (!pend) throw new Error('no decision pending');
  const d = pend.decision;
  validate(d, choice);
  s.pending = null;
  s.steps++;
  const r = pend.resume;
  switch (r.k) {
    case 'frame': {
      const f = s.stack[s.stack.length - 1] as Frame;
      if (r.mode === 'bool') f.vars.__a = choice[0] === 0;
      else if (r.mode === 'index') f.vars.__a = choice.slice();
      else if (r.mode === 'order') f.vars.__a = choice.slice();
      else f.vars.__a = choice.map((i) => (d.values as number[])[i] as number);
      break;
    }
    case 'main':
      doAction(env, s, (d.actions as Action[])[choice[0] as number] as Action);
      break;
    case 'goFirst': {
      const winner = d.player;
      s.first = choice[0] === 0 ? winner : opp(winner);
      emit(env, { type: 'go_first', player: s.first });
      s.step = 'deal';
      break;
    }
    case 'mulliganDraws':
      draw(env, s, r.p, choice[0] as number);
      s.step = r.p === 0 ? 'extra1' : 'place0';
      break;
    case 'setupActive': {
      const card = (d.values as number[])[choice[0] as number] as number;
      const ps = s.p[r.p];
      removeFrom(ps.hand, card);
      ps.active = newSlot(s, card);
      emit(env, { type: 'play_to_active', player: r.p, card, slot: ps.active.id });
      s.step = `bench${r.p}`;
      break;
    }
    case 'setupBench': {
      const ps = s.p[r.p];
      for (const i of choice) {
        const card = (d.values as number[])[i] as number;
        removeFrom(ps.hand, card);
        const sl = newSlot(s, card);
        ps.bench.push(sl);
        emit(env, { type: 'play_to_bench', player: r.p, card, slot: sl.id });
      }
      s.step = r.p === 0 ? 'place1' : 'prizes';
      break;
    }
    case 'promote': {
      const ps = s.p[r.p];
      const id = (d.values as number[])[choice[0] as number] as number;
      const sl = ps.bench.find((b) => b.id === id) as Slot;
      ps.bench = ps.bench.filter((b) => b !== sl);
      ps.active = sl;
      emit(env, { type: 'promote', player: r.p, slot: sl.id });
      break;
    }
  }
  advance(env, s);
}

function validate(d: Decision, choice: number[]): void {
  const n = d.actions?.length ?? d.values?.length ?? d.labels?.length ?? 0;
  if (choice.length < d.min || choice.length > d.max) {
    throw new Error(`choose ${d.min}..${d.max} options, got ${choice.length} (${d.prompt})`);
  }
  const seen = new Set<number>();
  for (const i of choice) {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`option ${i} out of range 0..${n - 1}`);
    if (seen.has(i)) throw new Error(`option ${i} chosen twice`);
    seen.add(i);
  }
}

// ---------------------------------------------------------------------------
// The kernel loop
// ---------------------------------------------------------------------------

export function advance(env: Env, s: GameState): void {
  let guard = 0;
  while (!s.pending && s.phase !== 'over') {
    if (++guard > 100000) throw new Error('engine loop guard tripped');
    if (s.stack.length) {
      run(env, s);
      continue;
    }
    if (s.queued.length) {
      // Optional triggers ("you may") become a yes/no first.
      const f = s.queued.shift() as Frame;
      s.stack.push(f);
      if (f.vars.__optional) {
        delete f.vars.__optional;
        f.code = wrapOptional(env, f.code);
      }
      continue;
    }
    if (s.phase === 'setup') setupStep(env, s);
    else turnStep(env, s);
  }
}

/** "You may" around a trigger program: compile once per program. */
function wrapOptional(env: Env, code: string): string {
  const key = `${code}?`;
  if (!env.ctx.code.has(key)) {
    const inner = env.ctx.code.get(code) ?? [];
    const shifted = inner.map((op) => ('to' in op ? { ...op, to: op.to + 2 } : op));
    env.ctx.code.set(key, [
      { o: 'ask', as: '__may', prompt: 'Use this effect?' },
      { o: 'jfalse', v: '__may', to: inner.length + 2 },
      ...shifted,
    ]);
  }
  return key;
}

// ---------------------------------------------------------------------------
// Setup (rulebook p.8, 18)
// ---------------------------------------------------------------------------

function isBasic(env: Env, c: number): boolean {
  const d = def(env.ctx, c);
  return d.kind === 'pokemon' && d.stage === 0;
}

function setupStep(env: Env, s: GameState): void {
  switch (s.step) {
    case 'coin': {
      if (env.ctx.opts.first !== null) {
        s.first = env.ctx.opts.first;
        emit(env, { type: 'go_first', player: s.first });
        s.step = 'deal';
        return;
      }
      const winner: Player = flipCoin(env, s, 0) ? 0 : 1;
      emit(env, { type: 'coin_toss', winner });
      s.pending = {
        decision: { player: winner, kind: 'goFirst', prompt: 'Go first?', min: 1, max: 1, labels: ['Go first', 'Go second'] },
        resume: { k: 'goFirst' },
      };
      return;
    }
    case 'deal': {
      // Shuffle, draw 7, mulligan until a Basic appears. Mutual mulligans cancel for the extra draws.
      for (const p of [0, 1] as Player[]) {
        const ps = s.p[p];
        shuffleDeck(env, s, p);
        draw(env, s, p, 7);
        let guard = 0;
        while (!ps.hand.some((c) => isBasic(env, c))) {
          if (++guard > 200 || !ps.deck.concat(ps.hand).some((c) => isBasic(env, c))) {
            // A deck with no Basic Pokémon can never start; it loses.
            endGame(env, s, opp(p), 'no Basic Pokémon');
            return;
          }
          emit(env, { type: 'mulligan', player: p, hand: ps.hand.slice() });
          ps.mulligans++;
          ps.deck.push(...ps.hand);
          ps.hand = [];
          shuffleDeck(env, s, p);
          draw(env, s, p, 7);
        }
        emit(env, { type: 'opening_hand', player: p, size: ps.hand.length });
      }
      s.step = 'extra0';
      return;
    }
    case 'extra0':
    case 'extra1': {
      const p: Player = s.step === 'extra0' ? 0 : 1;
      const extra = Math.max(0, s.p[opp(p)].mulligans - s.p[p].mulligans);
      if (!extra) {
        s.step = p === 0 ? 'extra1' : 'place0';
        return;
      }
      s.pending = {
        decision: {
          player: p,
          kind: 'mulliganDraws',
          prompt: `Your opponent took ${extra} extra mulligan(s). Draw how many cards?`,
          min: 1,
          max: 1,
          labels: Array.from({ length: extra + 1 }, (_, i) => `Draw ${i}`),
        },
        resume: { k: 'mulliganDraws', p },
      };
      return;
    }
    case 'place0':
    case 'place1': {
      const p: Player = s.step === 'place0' ? 0 : 1;
      const basics = s.p[p].hand.filter((c) => isBasic(env, c));
      s.pending = {
        decision: { player: p, kind: 'setupActive', prompt: 'Choose your Active Pokémon', min: 1, max: 1, values: basics },
        resume: { k: 'setupActive', p },
      };
      return;
    }
    case 'bench0':
    case 'bench1': {
      const p: Player = s.step === 'bench0' ? 0 : 1;
      const basics = s.p[p].hand.filter((c) => isBasic(env, c));
      if (!basics.length) {
        s.step = p === 0 ? 'place1' : 'prizes';
        return;
      }
      s.pending = {
        decision: {
          player: p,
          kind: 'setupBench',
          prompt: 'Put up to 5 Basic Pokémon onto your Bench',
          min: 0,
          max: Math.min(5, basics.length),
          values: basics,
        },
        resume: { k: 'setupBench', p },
      };
      return;
    }
    case 'prizes': {
      for (const p of [0, 1] as Player[]) {
        const ps = s.p[p];
        for (let i = 0; i < 6 && ps.deck.length; i++) ps.prizes.push(ps.deck.pop() as number);
      }
      s.phase = 'main';
      s.turn = 1;
      s.current = s.first;
      s.step = 'turnStart';
      return;
    }
    default:
      throw new Error(`bad setup step ${s.step}`);
  }
}

// ---------------------------------------------------------------------------
// The turn (rulebook p.9-13)
// ---------------------------------------------------------------------------

function turnStep(env: Env, s: GameState): void {
  switch (s.step) {
    case 'turnStart': {
      const p = s.current;
      const ps = s.p[p];
      ps.supporterPlayed = false;
      ps.stadiumPlayed = false;
      ps.energyAttached = false;
      ps.retreated = false;
      ps.stadiumAbilityUsed = false;
      ps.globalAbilitiesUsed = [];
      for (const sl of allSlots(ps)) sl.usedAbilities = [];
      s.attacked = false;
      emit(env, { type: 'turn_start', player: p, turn: s.turn });
      if (s.turn > env.ctx.opts.maxTurns) {
        endGame(env, s, null, 'turn limit');
        return;
      }
      // Draw; a player who can't draw at the start of their turn loses.
      if (!ps.deck.length) {
        endGame(env, s, opp(p), 'deck out');
        return;
      }
      draw(env, s, p, 1);
      s.step = 'main';
      return;
    }
    case 'main': {
      if (s.attacked) {
        s.afterKo = 'endTurn';
        s.step = 'ko';
        return;
      }
      const actions = legalActions(env, s, s.current);
      s.pending = {
        decision: { player: s.current, kind: 'main', prompt: 'Your turn', min: 1, max: 1, actions },
        resume: { k: 'main' },
      };
      return;
    }
    case 'ko':
      resolveKOs(env, s);
      return;
    case 'endTurn': {
      emit(env, { type: 'end_turn', player: s.current, turn: s.turn });
      // lane:misc — "at the end of your turn" effects (Powerglass, Ignition Energy) resolve before Checkup.
      for (const sl of allSlots(s.p[s.current])) queueTriggers(env, s, sl, s.current, 'endOfTurn');
      s.step = 'checkup';
      return;
    }
    case 'checkup':
      checkup(env, s);
      if (s.phase === 'over') return;
      s.afterKo = 'nextTurn';
      s.step = 'ko';
      return;
    case 'nextTurn': {
      s.effects = s.effects.filter((e) => e.until > s.turn);
      s.turn++;
      s.current = opp(s.current);
      s.step = 'turnStart';
      return;
    }
    default:
      throw new Error(`bad turn step ${s.step}`);
  }
}

/** The player's own first turn (the second player's first turn is turn 2). */
function ownFirstTurn(s: GameState, p: Player): boolean {
  return s.turn === (p === s.first ? 1 : 2);
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

export function legalActions(env: Env, s: GameState, p: Player): Action[] {
  const out: Action[] = [];
  const ps = s.p[p];
  const all = statics(env, s);
  const slots = allSlots(ps);
  const seen = new Set<string>();
  const once = (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const locked = itemLocked(env, s, p, all);

  for (const c of ps.hand) {
    const d = def(env.ctx, c);
    if (d.kind === 'pokemon') {
      if (d.stage === 0) {
        if (ps.bench.length < 5 && once(`b${d.idx}`)) out.push({ t: 'bench', card: c });
      } else if (!ownFirstTurn(s, p)) {
        for (const sl of slots) {
          const top = def(env.ctx, topCard(sl));
          if (top.name !== d.evolvesFrom) continue;
          if (sl.enteredTurn >= s.turn || sl.evolvedTurn >= s.turn) continue;
          if (once(`e${d.idx}:${sl.id}`)) out.push({ t: 'evolve', card: c, slot: sl.id });
        }
      }
    } else if (d.kind === 'energy') {
      if (ps.energyAttached || d.coverage === 'none') continue;
      for (const sl of slots) if (once(`a${d.idx}:${sl.id}`)) out.push({ t: 'attach', card: c, slot: sl.id });
    } else if (d.kind === 'trainer') {
      if (d.coverage === 'none') continue;
      if (d.playable && !evalCond(env, s, { player: p, slot: 0, vars: { __src: c } }, d.playable)) continue;
      if (d.script?.fix?.playAsBasic) {
        // lane:ghost — played onto the Bench as a Basic Pokémon; still an Item, so Item locks stop it.
        if (!locked && ps.bench.length < 5 && once(`b${d.idx}`)) out.push({ t: 'bench', card: c });
        continue;
      }
      if (d.ttype === 'item') {
        if (!locked && once(`t${d.idx}`)) out.push({ t: 'trainer', card: c });
      } else if (d.ttype === 'supporter') {
        // lane:metal: `firstTurnSupporter` (Carmine) lifts the first player's turn-1 ban.
        if (!ps.supporterPlayed && (s.turn !== 1 || d.script?.firstTurnSupporter) && once(`t${d.idx}`)) out.push({ t: 'trainer', card: c });
      } else if (d.ttype === 'stadium') {
        if (ps.stadiumPlayed) continue;
        if (s.stadium && def(env.ctx, s.stadium.card).name === d.name) continue;
        if (once(`t${d.idx}`)) out.push({ t: 'trainer', card: c });
      } else if (d.ttype === 'tool') {
        if (locked) continue;
        for (const sl of slots) {
          if (sl.tools.length >= 1) continue;
          if (once(`o${d.idx}:${sl.id}`)) out.push({ t: 'tool', card: c, slot: sl.id });
        }
      }
    }
  }

  // Retreat: once a turn; not while Asleep or Paralyzed; pay the cost in Energy.
  const act = ps.active;
  if (act && ps.bench.length && !ps.retreated && !(act.cond & (ASLEEP | PARALYZED)) && !cantRetreat(env, s, act, all)) {
    if (energyUnits(env, act).length >= retreatCost(env, s, act, all)) out.push({ t: 'retreat' });
  }

  // Activated Abilities.
  for (const sl of slots) {
    const d = def(env.ctx, topCard(sl));
    if (d.coverage !== 'full') continue;
    if (hasNoAbilities(env, s, sl, all)) continue;
    d.abilities.forEach((ab, i) => {
      const a = ab.script?.activated;
      if (!a || !ab.code) return;
      if (a.oncePerTurn !== false && sl.usedAbilities.includes(i)) return;
      if (a.globalOncePerTurn && ps.globalAbilitiesUsed.includes(ab.name)) return;
      if (a.activeOnly && ps.active !== sl) return;
      if (a.when && !evalCond(env, s, { player: p, slot: sl.id, vars: {} }, a.when)) return;
      if (abilityLost(env, s, sl, ab, all)) return; // lane:misc — Damp
      if (once(`ab${d.idx}:${i}:${a.globalOncePerTurn ? 'g' : sl.id}`)) out.push({ t: 'ability', slot: sl.id, idx: i });
    });
  }

  // Stadium ability ("once during each player's turn").
  if (s.stadium && !ps.stadiumAbilityUsed) {
    const d = def(env.ctx, s.stadium.card);
    if (d.stadiumCode && (!d.stadiumWhen || evalCond(env, s, { player: p, slot: 0, vars: {} }, d.stadiumWhen))) {
      out.push({ t: 'stadium' });
    }
  }

  // Attacks: not on the first player's first turn; not while Asleep/Paralyzed.
  if (act && s.turn !== 1 && !(act.cond & (ASLEEP | PARALYZED)) && !cantAttack(env, s, act, all)) {
    const d = def(env.ctx, topCard(act));
    const units = energyUnits(env, act);
    d.attacks.forEach((_atk, i) => {
      if (attackBlocked(env, s, act, _atk.name, all)) return; // lane:fighting
      if (canPay(attackCost(env, s, act, i, all), units)) out.push({ t: 'attack', idx: i });
    });
  }

  out.push({ t: 'end' });
  return out;
}

// ---------------------------------------------------------------------------
// Doing an action
// ---------------------------------------------------------------------------

function pushFrame(s: GameState, f: Omit<Frame, 'pc'> & { pc?: number }): void {
  s.stack.push({ pc: 0, ...f });
}

function doAction(env: Env, s: GameState, a: Action): void {
  const p = s.current;
  const ps = s.p[p];
  // After the action resolves, check Knock Outs, then come back to the main step.
  s.afterKo = 'main';
  s.step = 'ko';
  switch (a.t) {
    case 'end':
      s.afterKo = 'endTurn';
      return;
    case 'bench': {
      removeFrom(ps.hand, a.card);
      const sl = newSlot(s, a.card);
      ps.bench.push(sl);
      emit(env, { type: 'play_to_bench', player: p, card: a.card, slot: sl.id });
      queueTriggers(env, s, sl, p, 'playToBench');
      queueStadiumBench(env, s, sl, p); // lane:misc — Risky Ruins
      return;
    }
    case 'evolve': {
      const sl = allSlots(ps).find((x) => x.id === a.slot) as Slot;
      removeFrom(ps.hand, a.card);
      sl.cards.push(a.card);
      sl.evolvedTurn = s.turn;
      // Evolving clears Special Conditions and attack effects on the Pokémon.
      sl.cond = 0;
      s.effects = s.effects.filter((x) => !(x.slot === sl.id && x.fromAttack));
      emit(env, { type: 'evolve', player: p, card: a.card, slot: sl.id });
      queueTriggers(env, s, sl, p, 'evolveFromHand');
      return;
    }
    case 'attach': {
      const sl = allSlots(ps).find((x) => x.id === a.slot) as Slot;
      removeFrom(ps.hand, a.card);
      sl.energy.push(a.card);
      ps.energyAttached = true;
      emit(env, { type: 'attach', player: p, card: a.card, slot: sl.id });
      const d = def(env.ctx, a.card);
      for (const t of d.triggers) {
        if (t.t.on !== 'attachFromHand') continue;
        const f: Frame = { code: t.code, pc: 0, vars: {}, player: p, src: a.card, slot: sl.id, kind: 'energy' };
        if (t.t.when && !evalCond(env, s, { player: p, slot: sl.id, vars: {} }, t.t.when)) continue;
        if (t.t.optional) f.vars.__optional = true;
        s.queued.push(f);
      }
      queueOppAttachTriggers(env, s, p, sl); // lane:ghost (Gengar ex, Gnawing Curse)
      return;
    }
    case 'trainer': {
      const d = def(env.ctx, a.card);
      removeFrom(ps.hand, a.card);
      emit(env, { type: 'play_trainer', player: p, card: a.card });
      if (d.ttype === 'supporter') ps.supporterPlayed = true;
      if (d.ttype === 'stadium') {
        ps.stadiumPlayed = true;
        if (s.stadium) s.p[s.stadium.owner].discard.push(s.stadium.card);
        s.stadium = { card: a.card, owner: p };
        emit(env, { type: 'play_stadium', player: p, card: a.card });
        if (d.playCode) pushFrame(s, { code: d.playCode, vars: {}, player: p, src: a.card, slot: 0, kind: 'stadium' });
        return;
      }
      s.limbo.push(a.card);
      pushFrame(s, { code: d.playCode as string, vars: {}, player: p, src: a.card, slot: 0, kind: 'trainer' });
      return;
    }
    case 'tool': {
      const sl = allSlots(ps).find((x) => x.id === a.slot) as Slot;
      removeFrom(ps.hand, a.card);
      sl.tools.push(a.card);
      emit(env, { type: 'play_trainer', player: p, card: a.card });
      return;
    }
    case 'retreat': {
      const act = ps.active as Slot;
      const cost = retreatCost(env, s, act);
      ps.retreated = true;
      pushFrame(s, { code: retreatCode(env), vars: { cost }, player: p, src: topCard(act), slot: act.id, kind: 'rule' });
      return;
    }
    case 'ability': {
      const sl = allSlots(ps).find((x) => x.id === a.slot) as Slot;
      const d = def(env.ctx, topCard(sl));
      const ab = d.abilities[a.idx];
      if (!ab?.code) return;
      sl.usedAbilities.push(a.idx);
      if (ab.script?.activated?.globalOncePerTurn) ps.globalAbilitiesUsed.push(ab.name);
      emit(env, { type: 'use_ability', player: p, slot: sl.id, name: ab.name });
      pushFrame(s, { code: ab.code, vars: {}, player: p, src: topCard(sl), slot: sl.id, kind: 'ability' });
      return;
    }
    case 'stadium': {
      const st = s.stadium;
      if (!st) return;
      ps.stadiumAbilityUsed = true;
      const d = def(env.ctx, st.card);
      pushFrame(s, { code: d.stadiumCode as string, vars: {}, player: p, src: st.card, slot: 0, kind: 'stadium' });
      return;
    }
    case 'attack': {
      const act = ps.active as Slot;
      const d = def(env.ctx, topCard(act));
      const atk = d.attacks[a.idx];
      if (!atk) return;
      s.attacked = true;
      s.attackHits = []; // lane:fighting
      emit(env, { type: 'attack', player: p, slot: act.id, name: atk.name });
      const defender = s.p[opp(p)].active;
      pushFrame(s, {
        code: atk.code,
        vars: { __atkDef: d.idx, __atkIdx: a.idx, __def: defender ? defender.id : 0 },
        player: p,
        src: topCard(act),
        slot: act.id,
        kind: 'attack',
      });
      return;
    }
  }
}

/**
 * Retreat as a program: discard Energy that provides at least the cost (rulebook p.12), then switch.
 * The cost is in Energy units, so one card providing {C}{C}{C} pays a Retreat Cost of 3.
 */
function retreatCode(env: Env): string {
  const key = '__retreat';
  if (!env.ctx.code.has(key)) {
    env.ctx.code.set(key, [
      { o: 'step', s: { op: 'discardEnergy', from: 'self', count: { v: 'cost' }, units: true } },
      { o: 'step', s: { op: 'switch', who: 'self' } },
    ]);
  }
  return key;
}

// ---------------------------------------------------------------------------
// Knock Outs, Prize cards, promotion, winning (rulebook p.8, 14, 21, 23, 26)
// ---------------------------------------------------------------------------

function knockOut(env: Env, s: GameState, owner: Player, sl: Slot): void {
  const ps = s.p[owner];
  const card = topCard(sl);
  emit(env, { type: 'knockout', player: owner, slot: sl.id, card });
  ps.discard.push(...slotCards(sl));
  if (ps.active === sl) ps.active = null;
  else ps.bench = ps.bench.filter((b) => b !== sl);
  s.effects = s.effects.filter((x) => x.slot !== sl.id);
  if (ps.lastKoTurn !== s.turn) ps.prevKoTurn = ps.lastKoTurn; // lane:misc
  ps.lastKoTurn = s.turn;
}

/**
 * lane:fighting — Prize modifiers on attached Energy (Legacy Energy: "If the Pokémon this card is attached to is
 * Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card. This
 * effect ... can't be applied more than once per game."). Applies only to a Knock Out checked after an attack, of a
 * Pokémon that attack damaged, owned by the non-attacking player -- not to Checkup Knock Outs or damage counters.
 */
function koPrizeDelta(env: Env, s: GameState, owner: Player, sl: Slot): number {
  if (!s.attacked || s.afterKo === 'nextTurn' || owner === s.current) return 0;
  if (!(s.attackHits ?? []).includes(sl.id)) return 0;
  let delta = 0;
  for (const c of sl.energy) {
    const d = def(env.ctx, c);
    const m = d.coverage === 'full' ? d.script?.koPrizeDelta : undefined;
    if (!m) continue;
    const used = s.p[owner].oncePerGame ?? [];
    if (m.oncePerGame) {
      if (used.includes(d.name)) continue;
      s.p[owner].oncePerGame = [...used, d.name];
    }
    delta += m.delta;
  }
  return delta;
}

function resolveKOs(env: Env, s: GameState): void {
  // 1. Every Pokémon with damage ≥ its HP is Knocked Out (simultaneously).
  const ko: { owner: Player; slot: Slot; prizes: number }[] = [];
  // Gather the live statics once: maxHp's default recomputes them per Pokémon, and this runs after
  // every action (it was ~50% of search time). Nothing changes between the checks, so it is the same answer.
  // (Undamaged Pokémon can't be Knocked Out: max HP is at least 10.)
  let all: ReturnType<typeof statics> | null = null;
  for (const p of [0, 1] as Player[]) {
    for (const sl of allSlots(s.p[p])) {
      if (sl.damage > 0 && sl.damage >= maxHp(env, s, sl, (all ??= statics(env, s)))) {
        const prizes = Math.max(0, def(env.ctx, topCard(sl)).prizeValue + koPrizeDelta(env, s, p, sl)); // lane:fighting
        ko.push({ owner: p, slot: sl, prizes });
      }
    }
  }
  if (ko.length) {
    // lane:misc — Wonder Kiss: "When your opponent's Active Pokémon is Knocked Out, flip a coin. If heads, take 1 more
    // Prize card." Checked while the Pokémon are still in play; at most one per taker (it doesn't stack).
    const extra: [number, number] = [0, 0];
    const all = statics(env, s);
    for (const taker of [0, 1] as Player[]) {
      if (!ko.some((k) => k.owner !== taker && s.p[k.owner].active === k.slot)) continue;
      const x = extraPrizeFor(env, s, taker, all);
      if (x && (!(x.effect as { flip?: boolean }).flip || flipCoin(env, s, taker))) extra[taker] = 1;
    }
    for (const k of ko) knockOut(env, s, k.owner, k.slot);
    // 2. Prize cards: the player whose turn is next takes first (Compendium, 2018).
    const order: Player[] = [opp(s.current), s.current];
    for (const taker of order) {
      const n = ko.filter((k) => k.owner !== taker).reduce((a, k) => a + k.prizes, 0) + extra[taker];
      if (!n) continue;
      const tp = s.p[taker];
      let took = 0;
      for (let i = 0; i < n && tp.prizes.length; i++) {
        tp.hand.push(tp.prizes.pop() as number);
        took++;
      }
      tp.prizesTaken += took;
      emit(env, { type: 'prize_take', player: taker, n: took });
    }
    if (checkWin(env, s)) return;
  }
  // A Pokémon can also leave play without a Knock Out (shuffled into the deck): same win check.
  if (!ko.length && [0, 1].some((p) => !s.p[p as Player].active && !s.p[p as Player].bench.length) && checkWin(env, s)) return;
  // 3. Promote: a player with no Active and a Bench must promote.
  for (const p of [opp(s.current), s.current] as Player[]) {
    const ps = s.p[p];
    if (ps.active) continue;
    if (!ps.bench.length) continue; // checkWin already ended the game
    if (ps.bench.length === 1) {
      ps.active = ps.bench.shift() as Slot;
      emit(env, { type: 'promote', player: p, slot: ps.active.id });
      continue;
    }
    s.pending = {
      decision: {
        player: p,
        kind: 'promote',
        prompt: 'Choose your new Active Pokémon',
        min: 1,
        max: 1,
        values: ps.bench.map((b) => b.id),
      },
      resume: { k: 'promote', p },
    };
    return; // stay on 'ko'; the next pass sees the promoted Active and continues
  }
  s.step = s.afterKo;
}

/** Win conditions after Knock Outs. Returns true when the game ended. */
function checkWin(env: Env, s: GameState): boolean {
  const ways: [number, number] = [0, 0];
  for (const p of [0, 1] as Player[]) {
    const me = s.p[p];
    const them = s.p[opp(p)];
    if (me.prizes.length === 0 && me.prizesTaken > 0) ways[p]++;
    if (!them.active && !them.bench.length) ways[p]++;
  }
  if (!ways[0] && !ways[1]) return false;
  if (ways[0] === ways[1]) {
    // Both win in the same number of ways: a tiebreaker game. Recorded as a draw.
    endGame(env, s, null, 'simultaneous win');
  } else {
    const w: Player = ways[0] > ways[1] ? 0 : 1;
    endGame(env, s, w, s.p[w].prizes.length === 0 ? 'prizes' : 'no Pokémon in play');
  }
  return true;
}

export function endGame(env: Env, s: GameState, winner: Player | null, reason: string): void {
  s.phase = 'over';
  s.winner = winner;
  s.draw = winner === null;
  s.winReason = reason;
  s.pending = null;
  emit(env, { type: 'game_end', winner, reason, turn: s.turn });
}

// ---------------------------------------------------------------------------
// Pokémon Checkup (rulebook p.15): Poisoned, Burned, Asleep, Paralyzed
// ---------------------------------------------------------------------------

function checkup(env: Env, s: GameState): void {
  for (const p of [s.current, opp(s.current)] as Player[]) {
    const sl = s.p[p].active;
    if (!sl) continue;
    if (sl.cond & POISONED) sl.damage += 10;
    if (sl.cond & BURNED) {
      sl.damage += 20;
      if (flipCoin(env, s, p)) sl.cond &= ~BURNED;
    }
    if (sl.cond & ASLEEP) {
      if (flipCoin(env, s, p)) sl.cond &= ~ASLEEP;
    }
    // Paralyzed wears off during the Checkup after its owner's turn.
    if (sl.cond & PARALYZED && p === s.current) sl.cond &= ~PARALYZED;
  }
  // lane:misc — "During Pokémon Checkup" Abilities (Froslass) resolve after Special Conditions, before Knock Outs.
  for (const p of [s.current, opp(s.current)] as Player[]) {
    for (const sl of allSlots(s.p[p])) queueTriggers(env, s, sl, p, 'checkup');
  }
}

export { applyCondition, effectsPrevented };
