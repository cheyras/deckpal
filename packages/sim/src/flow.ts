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
import type { Op } from './compile.js';
import type { Filter, SpecialCondition } from './dsl.js';
import { evalCond, slotMatches } from './eval.js';
import { applyCondition, queueMovedToActive, queueOppAttachTriggers, queueStadiumBench, queueTriggers, run, swapActive } from './interp.js';
import {
  abilityLost,
  attackIsFrom,
  attackOptions,
  benchLimit,
  canAttackTwice,
  canPayAttack,
  checkupExtraCounters,
  confusionKept,
  retreatCoinFlip,
  returnToHandBlocked,
  toolLimit,
  playLocked,
  pokemonPlayLocked,
  extraPrizeEffects,
  koPrizeEffects,
  surviveKoCoinFlips,
  attackBlocked, // lane:fighting
  attackCoinFlips,
  canAttachFromHand,
  conditionImmune,
  cantAttack,
  cantRetreat,
  effectsPrevented,
  energyUnits,
  hasNoAbilities,
  itemLocked,
  koToHandCards,
  maxHp,
  mayEvolve,
  ownFirstTurn,
  retreatCost,
  statics,
} from './query.js';
import { leaveHand,
  allSlots,
  clearAttackEffects,
  draw,
  emit,
  findSlot,
  flipCoin,
  newSlot,
  opp,
  removeFrom,
  shuffleDeck,
  slotCards,
  takePicked,
  topCard,
} from './state.js';
import {
  ASLEEP,
  BURNED,
  CONFUSED,
  PARALYZED,
  POISONED,
  type Action,
  type Decision,
  type Frame,
  type GameState,
  type Player,
  type PlayerState,
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
    case 'mulliganDraws': {
      // Rulebook p.18: the extra cards come after both players have set up and set aside Prize
      // cards; any Basic Pokémon drawn this way may then go onto the Bench.
      const ps = s.p[r.p];
      const n = draw(env, s, r.p, choice[0] as number);
      const drawnBasics = ps.hand.slice(ps.hand.length - n).filter((c) => isBasic(env, c));
      const room = 5 - ps.bench.length;
      s.step = r.p === 0 ? 'extra1' : 'begin';
      if (drawnBasics.length && room > 0) {
        s.pending = {
          decision: {
            player: r.p,
            kind: 'setupBench',
            prompt: 'Put any Basic Pokémon you just drew onto your Bench',
            min: 0,
            max: Math.min(room, drawnBasics.length),
            values: drawnBasics,
          },
          resume: { k: 'extraBench', p: r.p },
        };
        return;
      }
      break;
    }
    case 'extraBench': {
      const ps = s.p[r.p];
      for (const i of choice) {
        const card = (d.values as number[])[i] as number;
        leaveHand(ps, card);
        const sl = newSlot(s, card);
        ps.bench.push(sl);
        emit(env, { type: 'play_to_bench', player: r.p, card, slot: sl.id });
      }
      break;
    }
    case 'setupActive': {
      const card = (d.values as number[])[choice[0] as number] as number;
      const ps = s.p[r.p];
      leaveHand(ps, card);
      ps.active = newSlot(s, card);
      emit(env, { type: 'play_to_active', player: r.p, card, slot: ps.active.id });
      s.step = `bench${r.p}`;
      break;
    }
    case 'setupBench': {
      const ps = s.p[r.p];
      for (const i of choice) {
        const card = (d.values as number[])[i] as number;
        leaveHand(ps, card);
        const sl = newSlot(s, card);
        ps.bench.push(sl);
        emit(env, { type: 'play_to_bench', player: r.p, card, slot: sl.id });
      }
      s.step = r.p === 0 ? 'place1' : 'prizes';
      break;
    }
    case 'benchDiscard': {
      // Pokémon put in the discard pile from the Bench with everything attached: not Knocked Out, no Prize cards.
      const ps = s.p[r.p];
      for (const i of choice) {
        const sl = ps.bench.find((b) => b.id === (d.values as number[])[i]);
        if (!sl) continue;
        ps.bench = ps.bench.filter((b) => b !== sl);
        const cards = slotCards(sl);
        ps.discard.push(...cards);
        s.effects = s.effects.filter((x) => x.slot !== sl.id);
        if (s.delayed?.length) s.delayed = s.delayed.filter((x) => x.slot !== sl.id);
        emit(env, { type: 'discard', player: r.p, cards });
      }
      break;
    }
    case 'promote': {
      const ps = s.p[r.p];
      const id = (d.values as number[])[choice[0] as number] as number;
      const sl = ps.bench.find((b) => b.id === id) as Slot;
      ps.bench = ps.bench.filter((b) => b !== sl);
      ps.active = sl;
      sl.movedActiveTurn = s.turn;
      emit(env, { type: 'promote', player: r.p, slot: sl.id });
      queueMovedToActive(env, s, sl, r.p);
      break;
    }
    case 'toolDiscard': {
      // The Pokémon may now have fewer Tools than it has: the cards chosen go to their owner's discard pile.
      const loc = findSlot(s, r.slot);
      if (loc) {
        const gone = choice.map((i) => (d.values as number[])[i] as number);
        loc.slot.tools = loc.slot.tools.filter((c) => !gone.includes(c));
        s.p[loc.owner].discard.push(...gone);
        emit(env, { type: 'discard', player: loc.owner, cards: gone });
      }
      break;
    }
    case 'endOrder': {
      // Several effects wait for the end of the turn: the one chosen goes first.
      const pick = s.queued.splice(choice[0] as number, 1);
      s.queued.unshift(...pick);
      break;
    }
    case 'koHand': {
      // "you may put ... into your hand instead of the discard pile": the answer waits on the Knocked Out Pokémon until it leaves play.
      const loc = findSlot(s, r.slot);
      if (loc) loc.slot.koHandAnswer = choice[0] === 0;
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
      const once = f.vars.__once !== undefined;
      if (f.vars.__optional) {
        delete f.vars.__optional;
        f.code = wrapOptional(env, f.code, once);
      } else if (once) f.code = wrapOptional(env, f.code, true, false);
      continue;
    }
    if (s.phase === 'setup') setupStep(env, s);
    else turnStep(env, s);
  }
}

/**
 * "You may" around a trigger program: compile once per program. `once`: a once-per-turn trigger, noted as used (by an `used` op)
 * only when it is accepted. `ask` false: no question, just the note.
 */
function wrapOptional(env: Env, code: string, once = false, ask = true): string {
  const key = `${code}${ask ? '?' : '!'}${once ? 'u' : ''}`;
  if (!env.ctx.code.has(key)) {
    const inner = env.ctx.code.get(code) ?? [];
    const head: Op[] = [];
    if (ask) head.push({ o: 'ask', as: '__may', prompt: 'Use this effect?' }, { o: 'jfalse', v: '__may', to: -1 });
    if (once) head.push({ o: 'used' });
    const n = head.length;
    for (const h of head) if (h.o === 'jfalse') h.to = inner.length + n;
    const shifted = inner.map((op) => ('to' in op ? { ...op, to: op.to + n } : op));
    env.ctx.code.set(key, [...head, ...shifted]);
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

/** "If this Pokémon is in your hand when you are setting up to play, you may put it face down in the Active Spot." */
function setupActiveAbility(env: Env, c: number): boolean {
  const d = def(env.ctx, c);
  return d.kind === 'pokemon' && d.coverage === 'full' && d.abilities.some((a) => a.script?.setupActive);
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
          ps.revealed = [];
          shuffleDeck(env, s, p);
          draw(env, s, p, 7);
        }
        emit(env, { type: 'opening_hand', player: p, size: ps.hand.length });
      }
      s.step = 'place0';
      return;
    }
    case 'extra0':
    case 'extra1': {
      const p: Player = s.step === 'extra0' ? 0 : 1;
      const extra = Math.max(0, s.p[opp(p)].mulligans - s.p[p].mulligans);
      if (!extra) {
        s.step = p === 0 ? 'extra1' : 'begin';
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
      // Explosiveness: a Pokémon in the hand with that Ability may be put face down in the Active Spot too.
      const basics = s.p[p].hand.filter((c) => isBasic(env, c) || setupActiveAbility(env, c));
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
      s.step = 'extra0';
      return;
    }
    case 'begin': {
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
      ps.playedThisTurn = [];
      delete ps.toolUsed;
      delete s.attackUses; // attack bookkeeping of the turn before (absent = none yet)
      delete s.attackedViaTool;
      delete s.noMoreAttacks;
      ps.prizesAtTurnStart = ps.prizesTaken;
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
        // An attack ends the turn, unless the Pokémon may attack again (Festival Lead) and can: Knock Outs and the new Active
        // Pokémon are settled by now, so "after your opponent chooses a new Active Pokémon" is this decision.
        if (attackAgainAvailable(env, s)) s.attacked = false;
        else {
          s.afterKo = 'endTurn';
          s.step = 'ko';
          return;
        }
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
      let global = false;
      // "At the end of ... turn" programs scheduled by the `delay` step, before Checkup. A target that is no longer
      // the Active Pokémon (left play by some route that did not clear it) drops the effect.
      if (s.delayed?.length) {
        const due = s.delayed.filter((d) => d.turn === s.turn);
        s.delayed = s.delayed.filter((d) => d.turn > s.turn);
        for (const d of due) {
          if (d.slot > 0) {
            const t = findSlot(s, d.slot);
            if (!t?.active) continue;
          } else global = true;
          s.queued.push({ code: d.code, pc: 0, vars: { __def: d.slot }, player: d.player, src: d.src, slot: d.from, kind: d.fromAttack ? 'attack' : 'trigger' });
        }
      }
      // lane:misc — "at the end of your turn" effects (Powerglass, Ignition Energy) resolve before Checkup.
      for (const sl of allSlots(s.p[s.current])) queueTriggers(env, s, sl, s.current, 'endOfTurn');
      // Both happen at the end of the turn, so the turn's player chooses the order (TPCi Rules Team 2025-05-01, ruling 2135). Asked only
      // when an effect not tied to a Pokémon (Amarys) is among at least two.
      if (global && s.queued.length >= 2) {
        s.step = 'checkup';
        s.pending = {
          decision: {
            player: s.current,
            kind: 'option',
            prompt: 'Resolve which end-of-turn effect first?',
            min: 1,
            max: 1,
            labels: s.queued.map((q) => def(env.ctx, q.src).name),
          },
          resume: { k: 'endOrder' },
        };
        return;
      }
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
      // Prize cards the player whose turn this was took during it ("Prize cards your opponent took during their last turn").
      const cp = s.p[s.current];
      cp.prizesLastTurn = cp.prizesTaken - (cp.prizesAtTurnStart ?? cp.prizesTaken);
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
  const room = benchLimit(env, s, p, all);
  const act = ps.active;

  // Attacks: not on the first player's first turn (unless the attack says "if you go first, you can use this attack during your
  // first turn"); not while Asleep/Paralyzed. Attacks printed on an attached Tool count (a Technical Machine). After an attack, a
  // Pokémon that may attack twice has only a second attack (a printed one: Festival Lead doesn't work with a Technical Machine,
  // TPCi Rules Team 2024-05-23, ruling 1974) or ending the turn.
  const attacked = (s.attackUses ?? 0) > 0;
  const attacks = (): void => {
    if (!act || act.cond & (ASLEEP | PARALYZED) || cantAttack(env, s, act, all)) return;
    if (attacked && !secondAttackOpen(env, s, act, all)) return;
    const units = energyUnits(env, act, s, all);
    for (const o of attackOptions(env, s, act, all)) {
      if (attacked && o.card !== undefined) continue;
      const sc = o.d.coverage === 'full' ? o.d.script?.attacks?.[o.atk.name] : undefined;
      if (s.turn === 1 && !sc?.firstTurn) continue;
      if (sc?.usable && !evalCond(env, s, { player: p, slot: act.id, vars: {} }, sc.usable)) continue;
      if (attackBlocked(env, s, act, o.atk.name, all)) continue; // lane:fighting
      if (canPayAttack(env, s, act, o.idx, units, all, o.card)) out.push(o.card === undefined ? { t: 'attack', idx: o.idx } : { t: 'attack', idx: o.idx, card: o.card });
    }
  };
  if (attacked) {
    attacks();
    out.push({ t: 'end' });
    return out;
  }

  const noStadium = playLocked(env, s, p, 'stadium', all);
  const noSupporter = playLocked(env, s, p, 'supporter', all);
  const noAce = playLocked(env, s, p, 'aceSpec', all);
  const noEvolve = playLocked(env, s, p, 'evolve', all);
  const noTool = playLocked(env, s, p, 'tool', all);

  for (const c of ps.hand) {
    const d = def(env.ctx, c);
    if (d.aceSpec && noAce && d.kind !== 'pokemon') continue; // "your opponent can't play any ACE SPEC cards from their hand"
    if (d.kind === 'pokemon') {
      if (d.stage === 0) {
        // "Your opponent can't play any Pokémon that has an Ability from their hand" (Potent Glare) stops benching them too.
        if (ps.bench.length < room && !pokemonPlayLocked(env, s, p, d, all) && once(`b${d.idx}`)) out.push({ t: 'bench', card: c });
      } else if (!noEvolve && !pokemonPlayLocked(env, s, p, d, all)) {
        // The name it evolves from, and the timing (not on the first turn, not the turn it was played or evolved), as the effects on
        // each Pokémon bend them (Boosted Evolution, Forest of Vitality, Rainbow DNA).
        for (const sl of slots) {
          if (!mayEvolve(env, s, p, sl, d, all)) continue;
          if (once(`e${d.idx}:${sl.id}`)) out.push({ t: 'evolve', card: c, slot: sl.id });
        }
      }
    } else if (d.kind === 'energy') {
      if (ps.energyAttached || d.coverage === 'none') continue;
      const only = d.script?.attachOnly; // "This card can only be attached to a Team Rocket's Pokémon."
      for (const sl of slots) if (canAttachFromHand(env, s, sl, all) && (!only || slotMatches(env, sl, only)) && once(`a${d.idx}:${sl.id}`)) out.push({ t: 'attach', card: c, slot: sl.id });
    } else if (d.kind === 'trainer') {
      if (d.coverage === 'none') continue;
      if (d.needsDeck && !ps.deck.length) continue; // it would do nothing (see CardDef.needsDeck)
      if (d.playable && !evalCond(env, s, { player: p, slot: 0, vars: { __src: c } }, d.playable)) continue;
      if (d.script?.fix?.playAsBasic) {
        // lane:ghost — played onto the Bench as a Basic Pokémon; still an Item, so Item locks stop it.
        if (!locked && ps.bench.length < room && once(`b${d.idx}`)) out.push({ t: 'bench', card: c });
        continue;
      }
      if (d.ttype === 'item') {
        // Rare Candy plays a Stage 2 from the hand to evolve: stopped by a lock on evolving from the hand too.
        if (!locked && !(noEvolve && evolvesFromHand(d)) && once(`t${d.idx}`)) out.push({ t: 'trainer', card: c });
      } else if (d.ttype === 'supporter') {
        // lane:metal: `firstTurnSupporter` (Carmine) lifts the first player's turn-1 ban.
        if (!noSupporter && !ps.supporterPlayed && (s.turn !== 1 || d.script?.firstTurnSupporter) && once(`t${d.idx}`)) out.push({ t: 'trainer', card: c });
      } else if (d.ttype === 'stadium') {
        // Ange Floette may be played over a Prism Tower even though a Stadium was played this turn.
        if ((ps.stadiumPlayed && !d.script?.extraStadium) || noStadium) continue;
        if (s.stadium && def(env.ctx, s.stadium.card).name === d.name) continue;
        if (once(`t${d.idx}`)) out.push({ t: 'trainer', card: c });
      } else if (d.ttype === 'tool') {
        // Pokémon Tools are their own Trainer category, not Items: an Item lock (Itchy Pollen) does not stop them, a Tool lock does.
        if (noTool) continue;
        for (const sl of slots) {
          if (sl.tools.length >= toolLimit(env, s, sl, all)) continue;
          if (once(`o${d.idx}:${sl.id}`)) out.push({ t: 'tool', card: c, slot: sl.id });
        }
      }
    }
  }

  // Retreat: once a turn; not while Asleep or Paralyzed; pay the cost in Energy.
  if (act && ps.bench.length && !ps.retreated && !(act.cond & (ASLEEP | PARALYZED)) && !cantRetreat(env, s, act, all)) {
    if (energyUnits(env, act, s, all).length >= retreatCost(env, s, act, all)) out.push({ t: 'retreat' });
  }

  // Activated Abilities.
  for (const sl of slots) {
    const d = def(env.ctx, topCard(sl));
    if (d.coverage !== 'full') continue;
    if (hasNoAbilities(env, s, sl, all)) continue;
    d.abilities.forEach((ab, i) => {
      const a = ab.script?.activated;
      if (!a || !ab.code || a.fromHand) return; // (an Ability used from the hand is offered below)
      if (a.oncePerTurn !== false && sl.usedAbilities.includes(i)) return;
      if (a.globalOncePerTurn && ps.globalAbilitiesUsed.includes(ab.name)) return;
      if (a.activeOnly && ps.active !== sl) return;
      if (a.when && !evalCond(env, s, { player: p, slot: sl.id, vars: {} }, a.when)) return;
      if (abilityLost(env, s, sl, ab, all)) return; // lane:misc — Damp
      if (once(`ab${d.idx}:${i}:${a.globalOncePerTurn ? 'g' : sl.id}`)) out.push({ t: 'ability', slot: sl.id, idx: i });
    });
  }

  // Abilities used from the hand (Klinklang, Emergency Rotation): the Pokémon is a card in the hand, not in play.
  for (const c of ps.hand) {
    const d = def(env.ctx, c);
    if (d.kind !== 'pokemon' || d.coverage !== 'full') continue;
    d.abilities.forEach((ab, i) => {
      const a = ab.script?.activated;
      if (!a?.fromHand || !ab.code) return;
      if (a.when && !evalCond(env, s, { player: p, slot: 0, vars: { __this: [c] } }, a.when)) return;
      if (once(`h${d.idx}:${i}`)) out.push({ t: 'ability', slot: 0, idx: i, card: c });
    });
  }

  // Stadium ability ("once during each player's turn").
  if (s.stadium && !ps.stadiumAbilityUsed) {
    const d = def(env.ctx, s.stadium.card);
    if (d.stadiumCode && (!d.stadiumWhen || evalCond(env, s, { player: p, slot: 0, vars: {} }, d.stadiumWhen))) {
      out.push({ t: 'stadium' });
    }
  }

  attacks();

  out.push({ t: 'end' });
  return out;
}

/** A Trainer that plays a Pokémon from the hand to evolve one (Rare Candy), found from its script. */
const EVOLVES_FROM_HAND = new WeakMap<object, boolean>();
function evolvesFromHand(d: { script: { play?: unknown } | null }): boolean {
  let v = EVOLVES_FROM_HAND.get(d);
  if (v === undefined) EVOLVES_FROM_HAND.set(d, (v = JSON.stringify(d.script?.play ?? []).includes('"fn":"rareCandy"')));
  return v;
}

/**
 * May the Pokémon in the Active Spot attack a second time this turn: it attacked once (with a printed attack), it is still the
 * Active Pokémon that attacked, no effect ended the turn, and an `attackTwice` effect is in force right now.
 */
function secondAttackOpen(env: Env, s: GameState, act: Slot, all: ReturnType<typeof statics>): boolean {
  return (s.attackUses ?? 0) === 1 && !s.noMoreAttacks && !s.attackedViaTool && s.attackBy === act.id && canAttackTwice(env, s, act, all);
}

/** After an attack: is a second attack on offer to the current player? */
function attackAgainAvailable(env: Env, s: GameState): boolean {
  if ((s.attackUses ?? 0) !== 1 || s.noMoreAttacks) return false;
  return legalActions(env, s, s.current).some((a) => a.t === 'attack');
}

// ---------------------------------------------------------------------------
// Doing an action
// ---------------------------------------------------------------------------

/** A card the player played from their hand by their own action (the `playedThisTurn` condition). */
function played(ps: PlayerState, card: number): void {
  (ps.playedThisTurn ??= []).push(card);
}

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
      leaveHand(ps, a.card);
      played(ps, a.card);
      const sl = newSlot(s, a.card);
      ps.bench.push(sl);
      emit(env, { type: 'play_to_bench', player: p, card: a.card, slot: sl.id });
      queueTriggers(env, s, sl, p, 'playToBench');
      queueStadiumBench(env, s, sl, p); // lane:misc — Risky Ruins
      return;
    }
    case 'evolve': {
      const sl = allSlots(ps).find((x) => x.id === a.slot) as Slot;
      leaveHand(ps, a.card);
      played(ps, a.card);
      // Once-per-turn use is per Ability: the Evolution's own Abilities are fresh even if the Basic used one this
      // turn (rules audit). A same-named Ability stays spent — see the todo in rules-audit.test.ts.
      const spent = sl.usedAbilities.map((i) => def(env.ctx, topCard(sl)).abilities[i]?.name);
      sl.cards.push(a.card);
      sl.usedAbilities = def(env.ctx, a.card).abilities.flatMap((ab, i) => (spent.includes(ab.name) ? [i] : []));
      sl.evolvedTurn = s.turn;
      // Evolving clears Special Conditions and attack effects on the Pokémon (and "moved to the Active Spot": ruling 2265). Dizzying Valley
      // keeps Confusion.
      sl.cond = confusionKept(env, s, sl) ? sl.cond & CONFUSED : 0;
      delete sl.movedActiveTurn;
      clearAttackEffects(s, sl.id);
      emit(env, { type: 'evolve', player: p, card: a.card, slot: sl.id });
      queueTriggers(env, s, sl, p, 'evolveFromHand');
      return;
    }
    case 'attach': {
      const sl = allSlots(ps).find((x) => x.id === a.slot) as Slot;
      leaveHand(ps, a.card);
      played(ps, a.card);
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
      leaveHand(ps, a.card);
      played(ps, a.card);
      emit(env, { type: 'play_trainer', player: p, card: a.card });
      if (d.ttype === 'supporter') ps.supporterPlayed = true;
      if (d.ttype === 'stadium') {
        ps.stadiumPlayed = true;
        if (s.stadium) {
          // A Stadium that changes Bench sizes leaves: its player is the one who discards first (enforceBenchLimit).
          if (def(env.ctx, s.stadium.card).statics.some((x) => x.effect.k === 'benchSize')) s.benchOwner = s.stadium.owner;
          s.p[s.stadium.owner].discard.push(s.stadium.card);
        }
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
      leaveHand(ps, a.card);
      played(ps, a.card);
      sl.tools.push(a.card);
      emit(env, { type: 'play_trainer', player: p, card: a.card });
      return;
    }
    case 'retreat': {
      const act = ps.active as Slot;
      const cost = retreatCost(env, s, act);
      ps.retreated = true;
      // Goodra, Slimy Sliding: "your opponent flips a coin. If tails, Energy for its Retreat Cost is not discarded, and they don't switch
      // Pokémon." The retreat is used up all the same (TPCi Rules Team 2026-05-21, ruling 2348). The effect doesn't stack: one flip.
      if (retreatCoinFlip(p, statics(env, s)) && !flipCoin(env, s, p)) return;
      pushFrame(s, { code: retreatCode(env), vars: { cost }, player: p, src: topCard(act), slot: act.id, kind: 'rule' });
      return;
    }
    case 'ability': {
      if (a.card !== undefined) {
        // Used from the hand: the card stays there until the Ability's effect moves it.
        const hd = def(env.ctx, a.card);
        const hab = hd.abilities[a.idx];
        if (!hab?.code || !ps.hand.includes(a.card)) return;
        emit(env, { type: 'use_ability', player: p, slot: 0, name: hab.name });
        pushFrame(s, { code: hab.code, vars: { __this: [a.card] }, player: p, src: a.card, slot: 0, kind: 'ability' });
        return;
      }
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
      emit(env, { type: 'use_ability', player: p, slot: 0, name: d.name });
      pushFrame(s, { code: d.stadiumCode as string, vars: {}, player: p, src: st.card, slot: 0, kind: 'stadium' });
      return;
    }
    case 'attack': {
      const act = ps.active as Slot;
      // An attack printed on an attached Tool (`card`) runs as if printed on the Pokémon.
      const d = def(env.ctx, a.card ?? topCard(act));
      const atk = d.attacks[a.idx];
      if (!atk) return;
      s.attacked = true;
      s.attackUses = (s.attackUses ?? 0) + 1;
      s.attackedViaTool = a.card !== undefined;
      s.attackHits = []; // lane:fighting
      s.attackBy = act.id;
      s.attackByCard = topCard(act);
      emit(env, { type: 'attack', player: p, slot: act.id, name: atk.name });
      // "If the Defending Pokémon tries to use an attack, flip a coin. If tails, that attack doesn't happen." The flip for
      // such an effect comes first, before Confusion's (rulings 2326 and 2317); on tails the attack never happens.
      // A "flips N coins, if either of them is tails" effect flips all N, then stops the attack if any was tails.
      for (const coins of attackCoinFlips(env, s, act)) {
        let tails = false;
        for (let i = 0; i < coins; i++) if (!flipCoin(env, s, p)) tails = true;
        if (tails) return;
      }
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

/**
 * Is this Pokémon (owned by `owner`) being Knocked Out by damage from an attack from the opponent's Pokémon: checked after an
 * attack, for a Pokémon that attack damaged, owned by the non-attacking player -- not a Checkup Knock Out, not damage counters.
 */
function koByAttack(s: GameState, owner: Player, sl: Slot): boolean {
  return s.attacked && s.afterKo !== 'nextTurn' && owner !== s.current && (s.attackHits ?? []).includes(sl.id);
}

function knockOut(env: Env, s: GameState, owner: Player, sl: Slot, toHand: readonly number[] = []): void {
  const ps = s.p[owner];
  const card = topCard(sl);
  emit(env, { type: 'knockout', player: owner, slot: sl.id, card });
  ps.discard.push(...slotCards(sl).filter((c) => !toHand.includes(c)));
  // "put it into your hand instead of the discard pile": a Knock Out all the same (the opponent takes its Prize cards), but those
  // cards are face up, and known to be in the hand.
  for (const c of toHand) {
    ps.hand.push(c);
    ps.revealed.push(c);
  }
  if (ps.active === sl) ps.active = null;
  else ps.bench = ps.bench.filter((b) => b !== sl);
  s.effects = s.effects.filter((x) => x.slot !== sl.id);
  if (s.delayed?.length) s.delayed = s.delayed.filter((d) => d.slot !== sl.id);
  if (ps.lastKoTurn !== s.turn) ps.prevKoTurn = ps.lastKoTurn; // lane:misc
  ps.lastKoTurn = s.turn;
  // The card each Knocked Out Pokémon was, for this and the previous turn ("any of your Team Rocket's Pokémon were Knocked Out").
  if (ps.koCardsTurn === s.turn) ps.koCards = [...(ps.koCards ?? []), card];
  else {
    ps.prevKoCards = ps.koCards;
    ps.prevKoCardsTurn = ps.koCardsTurn;
    ps.koCards = [card];
    ps.koCardsTurn = s.turn;
  }
  // lane:trevenant — "Knocked Out by damage from an attack during your opponent's last turn" (Hop's Trevenant): same test
  // as koPrizeDelta — after an attack, a Pokémon that attack damaged, of the non-attacking player, not a Checkup KO.
  if (koByAttack(s, owner, sl)) {
    ps.attackKoCards = ps.attackKoTurn === s.turn ? [...(ps.attackKoCards ?? []), card] : [card];
    ps.attackKoTurn = s.turn;
  }
}

/**
 * lane:fighting — Prize modifiers on attached Energy (Legacy Energy: "If the Pokémon this card is attached to is
 * Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card. This
 * effect ... can't be applied more than once per game."). Applies only to a Knock Out checked after an attack, of a
 * Pokémon that attack damaged, owned by the non-attacking player -- not to Checkup Knock Outs or damage counters.
 */
function koPrizeDelta(env: Env, s: GameState, owner: Player, sl: Slot): number {
  if (!koByAttack(s, owner, sl)) return 0;
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

/**
 * A Pokémon that can't be affected by a Special Condition (Bubbly Water Energy, Dopey Face) recovers from it as soon as the
 * immunity applies: an Energy attached, an Ability back on. Run after every action and at Checkup.
 */
const CONDITION_BITS: [SpecialCondition, number][] = [
  ['asleep', ASLEEP],
  ['confused', CONFUSED],
  ['paralyzed', PARALYZED],
  ['poisoned', POISONED],
  ['burned', BURNED],
];
function stripImmuneConditions(env: Env, s: GameState): void {
  let all: ReturnType<typeof statics> | null = null;
  for (const p of [0, 1] as Player[]) {
    const sl = s.p[p].active;
    if (!sl || !sl.cond) continue;
    for (const [c, bit] of CONDITION_BITS) {
      if (sl.cond & bit && conditionImmune(env, s, sl, c, (all ??= statics(env, s)))) sl.cond &= ~bit;
    }
  }
}

/**
 * A player with more Benched Pokémon than their Bench allows (a Stadium that raised the limit left, or the Pokémon that made them
 * eligible did) discards Benched Pokémon of their choice down to it (Area Zero Underdepths: "If a player no longer has any Tera
 * Pokémon in play, that player discards Pokémon from their Bench until they have 5. When this card leaves play, both players
 * discard ..., and the player who played this card discards first"). Returns true when a decision is pending.
 */
function enforceBenchLimit(env: Env, s: GameState): boolean {
  const owner = s.stadium && def(env.ctx, s.stadium.card).statics.some((x) => x.effect.k === 'benchSize') ? s.stadium.owner : undefined;
  if (owner !== undefined) s.benchOwner = owner;
  if (s.p[0].bench.length <= 5 && s.p[1].bench.length <= 5) {
    if (owner === undefined) delete s.benchOwner;
    return false;
  }
  const all = statics(env, s);
  const first = owner ?? s.benchOwner ?? s.current;
  for (const p of [first, opp(first)] as Player[]) {
    const ps = s.p[p];
    const excess = ps.bench.length - benchLimit(env, s, p, all);
    if (excess <= 0) continue;
    s.pending = {
      decision: {
        player: p,
        kind: 'slots',
        prompt: `Discard ${excess} Benched Pokémon`,
        min: excess,
        max: excess,
        values: ps.bench.map((b) => b.id),
      },
      resume: { k: 'benchDiscard', p },
    };
    return true;
  }
  if (owner === undefined) delete s.benchOwner;
  return false;
}

/**
 * Energy that "can only be attached to" a kind of Pokémon and is on another is discarded (Team Rocket's Energy), and a Pokémon with more
 * Pokémon Tool cards than it may have (Rotom ex's Multi Adapter went away) discards down: its owner chooses which. Returns true when a
 * decision is pending.
 */
function enforceAttachments(env: Env, s: GameState): boolean {
  let all: ReturnType<typeof statics> | null = null;
  for (const p of [s.current, opp(s.current)] as Player[]) {
    for (const sl of allSlots(s.p[p])) {
      const bad = sl.energy.filter((c) => {
        const only = def(env.ctx, c).script?.attachOnly;
        return !!only && !slotMatches(env, sl, only);
      });
      if (bad.length) {
        sl.energy = sl.energy.filter((c) => !bad.includes(c));
        s.p[p].discard.push(...bad);
        emit(env, { type: 'discard', player: p, cards: bad });
      }
      if (sl.tools.length > 1) {
        const limit = toolLimit(env, s, sl, (all ??= statics(env, s)));
        const excess = sl.tools.length - limit;
        if (excess > 0) {
          s.pending = {
            decision: { player: p, kind: 'cards', prompt: `Discard ${excess} Pokémon Tool card${excess === 1 ? '' : 's'} from ${def(env.ctx, topCard(sl)).name}`, min: excess, max: excess, values: sl.tools.slice() },
            resume: { k: 'toolDiscard', slot: sl.id },
          };
          return true;
        }
      }
    }
  }
  return false;
}

function resolveKOs(env: Env, s: GameState): void {
  stripImmuneConditions(env, s);
  if (enforceAttachments(env, s)) return;
  // A Bench that is too big is dealt with first, before Knock Outs: a Pokémon with lethal damage may be the one discarded (TPCi Rules
  // Team 2026-03-12, ruling 2305).
  if (enforceBenchLimit(env, s)) return;
  // 1. Every Pokémon with damage ≥ its HP is Knocked Out (simultaneously).
  const ko: { owner: Player; slot: Slot; prizes: number }[] = [];
  // Gather the live statics once: maxHp's default recomputes them per Pokémon, and this runs after
  // every action (it was ~50% of search time). Nothing changes between the checks, so it is the same answer.
  // (Undamaged Pokémon can't be Knocked Out: max HP is at least 10.)
  let all: ReturnType<typeof statics> | null = null;
  const queuedBefore = s.queued.length;
  for (const p of [0, 1] as Player[]) {
    for (const sl of allSlots(s.p[p])) {
      if (sl.damage > 0 && sl.damage >= maxHp(env, s, sl, (all ??= statics(env, s)))) {
        if (koByAttack(s, p, sl) && !sl.koTriggered) {
          // "If this Pokémon would be Knocked Out by damage from an attack, flip a coin. If heads, ... its remaining HP becomes 10."
          // The attack's full damage was dealt; the flip comes now, after it (ruling 2287). Then, for a Pokémon that is Knocked Out:
          // its "Knocked Out by damage from an attack" Abilities, while it is still in play (before it goes to the discard pile).
          let survived = false;
          for (let n = surviveKoCoinFlips(env, s, sl, all); n > 0 && !survived; n--) survived = flipCoin(env, s, p);
          if (survived) {
            sl.damage = Math.max(0, maxHp(env, s, sl, all) - 10);
            continue;
          }
          sl.koTriggered = true;
          queueTriggers(env, s, sl, p, 'knockedOutByAttack');
        }
        ko.push({ owner: p, slot: sl, prizes: 0 });
      } else {
        if (sl.koTriggered) delete sl.koTriggered; // a trigger saved it from the Knock Out
        if (sl.koHandAnswer !== undefined) delete sl.koHandAnswer;
      }
    }
  }
  // Those Abilities resolve first; then Knock Outs are checked again (the flagged Pokémon are not asked twice).
  if (s.queued.length > queuedBefore) return;
  if (ko.length) {
    all = statics(env, s);
    // "you may put it into your hand instead of the discard pile": ask first, before anything below flips a coin or is used up.
    const toHand = new Map<Slot, number[]>();
    for (const k of ko) {
      if (!koByAttack(s, k.owner, k.slot)) continue;
      // Milotic's Mentally Calm: nothing of that player's Pokémon can be put into their hand.
      const { always, may } = returnToHandBlocked(env, s, k.owner, all) ? { always: [], may: [] } : koToHandCards(env, s, k.slot, all);
      if (may.length && k.slot.koHandAnswer === undefined) {
        s.pending = {
          decision: {
            player: k.owner,
            kind: 'yesno',
            prompt: `Put ${[...new Set(may.map((c) => def(env.ctx, c).name))].join(', ')} into your hand instead of the discard pile?`,
            min: 1,
            max: 1,
            labels: ['Yes', 'No'],
          },
          resume: { k: 'koHand', slot: k.slot.id },
        };
        return;
      }
      const cards = k.slot.koHandAnswer ? [...always, ...may] : always;
      if (cards.length) toHand.set(k.slot, cards);
    }
    // Prize cards for each Knocked Out Pokémon: its value, changed by Energy (Legacy Energy) and by Abilities of Pokémon in play
    // (Shadowy Concealment, Fragile Husk), checked while everything is still in play.
    for (const k of ko) {
      const m = koPrizeEffects(env, s, k.slot, all, koByAttack(s, k.owner, k.slot));
      const energy = koPrizeDelta(env, s, k.owner, k.slot); // lane:fighting
      k.prizes = m.none ? 0 : Math.max(0, def(env.ctx, topCard(k.slot)).prizeValue + energy + m.delta);
    }
    // lane:misc — Wonder Kiss: "When your opponent's Active Pokémon is Knocked Out, flip a coin. If heads, take 1 more
    // Prize card." Checked while the Pokémon are still in play; at most one per taker (it doesn't stack). An effect with an
    // `attacker` filter (Anthea & Concordia) needs the Knock Out to be by damage from an attack of a matching Pokémon.
    const extra: [number, number] = [0, 0];
    for (const taker of [0, 1] as Player[]) {
      const kos = ko.filter((k) => k.owner !== taker && s.p[k.owner].active === k.slot);
      const counted = new Set<string>();
      for (const x of extraPrizeEffects(taker, all)) {
        const e = x.effect as { flip?: boolean; amount?: number; attacker?: Filter; noStack?: string; ko?: Filter; byThis?: boolean };
        if (e.ko || e.byThis) {
          // "If your opponent's Basic Pokémon is Knocked Out by damage from an attack used by this Pokémon, take 1 more Prize card":
          // each Pokémon Knocked Out that way, wherever it was, with the attack the effect names.
          for (const k of ko) {
            if (k.owner === taker || !koByAttack(s, k.owner, k.slot)) continue;
            if (e.ko && !slotMatches(env, k.slot, e.ko)) continue;
            if (e.byThis && s.attackBy !== x.slot) continue;
            if (e.attacker && !attackIsFrom(env, s, e.attacker, all)) continue;
            const key = e.noStack ?? (e.amount === undefined ? 'extraPrize' : undefined);
            if (key) {
              if (counted.has(`${key}:${k.slot.id}`)) continue;
              counted.add(`${key}:${k.slot.id}`);
            }
            if (e.flip && !flipCoin(env, s, taker)) continue;
            extra[taker] += e.amount ?? 1;
          }
          continue;
        }
        if (!kos.length) continue;
        if (e.attacker && !(koByAttack(s, kos[0]!.owner, kos[0]!.slot) && attackIsFrom(env, s, e.attacker, all))) continue;
        const key = e.noStack ?? (e.amount === undefined ? 'extraPrize' : undefined);
        if (key) {
          if (counted.has(key)) continue;
          counted.add(key);
        }
        if (e.flip && !flipCoin(env, s, taker)) continue;
        extra[taker] += e.amount ?? 1;
      }
    }
    for (const k of ko) knockOut(env, s, k.owner, k.slot, toHand.get(k.slot));
    // 2. Prize cards: the player whose turn is next takes first (Compendium, 2018).
    const order: Player[] = [opp(s.current), s.current];
    for (const taker of order) {
      const n = ko.filter((k) => k.owner !== taker).reduce((a, k) => a + k.prizes, 0) + extra[taker];
      if (!n) continue;
      const tp = s.p[taker];
      let took = 0;
      for (let i = 0; i < n && tp.prizes.length; i++) {
        const pc = takePicked(tp.prizes, env.replay?.prize?.(taker, tp.prizes)) ?? (tp.prizes.pop() as number);
        tp.hand.push(pc);
        removeFrom(tp.revealed, pc); // Prize cards are taken face down
        took++;
      }
      tp.prizesTaken += took;
      emit(env, { type: 'prize_take', player: taker, n: took });
    }
    if (checkWin(env, s)) return;
  }
  // A Pokémon can also leave play without a Knock Out (shuffled into the deck): same win check.
  if (!ko.length && [0, 1].some((p) => !s.p[p as Player].active && !s.p[p as Player].bench.length) && checkWin(env, s)) return;
  // A Bench left too big by the Knock Outs (the only Tera Pokémon was Knocked Out) is cut down before the new Active Pokémon is
  // chosen (TPCi Rules Team 2024-09-12, ruling 2026; 2025-04-03, rulings 2131 and 2132).
  if (enforceBenchLimit(env, s)) return;
  // 3. Promote: a player with no Active and a Bench must promote.
  for (const p of [opp(s.current), s.current] as Player[]) {
    const ps = s.p[p];
    if (ps.active) continue;
    if (!ps.bench.length) continue; // checkWin already ended the game
    if (ps.bench.length === 1) {
      ps.active = ps.bench.shift() as Slot;
      ps.active.movedActiveTurn = s.turn;
      emit(env, { type: 'promote', player: p, slot: ps.active.id });
      queueMovedToActive(env, s, ps.active, p);
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
  stripImmuneConditions(env, s);
  for (const p of [s.current, opp(s.current)] as Player[]) {
    const sl = s.p[p].active;
    if (!sl) continue;
    if (sl.cond & POISONED) {
      // 1 damage counter, or the amount the Poison came with ("place 16 damage counters instead of 1"), at every Checkup.
      // ...plus what Perilous Jungle and the like add to it.
      const n = (sl.poisonCounters ?? 1) + checkupExtraCounters(env, s, sl, 'poisoned');
      sl.damage += 10 * n;
      emit(env, { type: 'counters', player: p, slot: sl.id, n, checkup: true });
    }
    if (sl.cond & BURNED) {
      // 2 damage counters, or the amount the Burn came with, and what Magma Surge adds: all before the flip below.
      const bn = (sl.burnCounters ?? 2) + checkupExtraCounters(env, s, sl, 'burned');
      sl.damage += 10 * bn;
      emit(env, { type: 'counters', player: p, slot: sl.id, n: bn, checkup: true });
      if (flipCoin(env, s, p)) sl.cond &= ~BURNED;
    }
    if (sl.cond & ASLEEP) {
      if (flipCoin(env, s, p)) sl.cond &= ~ASLEEP;
    }
    // Paralyzed wears off during the Checkup after its owner's turn — the owner's NEXT turn
    // when it was Paralyzed during its own turn (it must have been Paralyzed since that
    // turn began; Compendium). `paralyzedTurn` unset = applied before this turn.
    if (sl.cond & PARALYZED && p === s.current && sl.paralyzedTurn !== s.turn) sl.cond &= ~PARALYZED;
  }
  // lane:misc — "During Pokémon Checkup" Abilities (Froslass) resolve after Special Conditions, before Knock Outs.
  for (const p of [s.current, opp(s.current)] as Player[]) {
    for (const sl of allSlots(s.p[p])) queueTriggers(env, s, sl, p, 'checkup');
  }
}

export { applyCondition, effectsPrevented };
