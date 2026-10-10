/**
 * State construction, cloning and small zone helpers. Nothing here knows the
 * rules; it only keeps every card in exactly one zone.
 */
import type { Env, GameContext } from './context.js';
import { deriveSeed, step } from './rng.js';
import type { Decision, GameEvent, GameState, Player, PlayerState, Slot } from './types.js';

function emptyPlayer(deck: number[]): PlayerState {
  return {
    deck,
    hand: [],
    discard: [],
    prizes: [],
    lost: [],
    active: null,
    bench: [],
    mulligans: 0,
    prizesTaken: 0,
    supporterPlayed: false,
    stadiumPlayed: false,
    energyAttached: false,
    retreated: false,
    stadiumAbilityUsed: false,
    globalAbilitiesUsed: [],
    lastKoTurn: -99,
    prizesKnown: false,
    knownTop: 0,
    revealed: [],
  };
}

export function newState(ctx: GameContext, seed: number): GameState {
  return {
    v: 1,
    seed,
    rng: [deriveSeed(seed, 1), deriveSeed(seed, 2), deriveSeed(seed, 3)],
    forcedCoins: [],
    turn: 0,
    current: 0,
    first: 0,
    phase: 'setup',
    step: 'start',
    p: [emptyPlayer(ctx.iids[0].slice()), emptyPlayer(ctx.iids[1].slice())],
    nextSlot: 1,
    stadium: null,
    stack: [],
    pending: null,
    effects: [],
    attacked: false,
    queued: [],
    limbo: [],
    afterKo: 'main',
    winner: null,
    draw: false,
    winReason: null,
    steps: 0,
  };
}

function cloneSlot(s: Slot): Slot {
  return {
    id: s.id,
    cards: s.cards.slice(),
    energy: s.energy.slice(),
    tools: s.tools.slice(),
    damage: s.damage,
    cond: s.cond,
    enteredTurn: s.enteredTurn,
    evolvedTurn: s.evolvedTurn,
    usedAbilities: s.usedAbilities.slice(),
  };
}

function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    deck: p.deck.slice(),
    hand: p.hand.slice(),
    discard: p.discard.slice(),
    prizes: p.prizes.slice(),
    lost: p.lost.slice(),
    active: p.active ? cloneSlot(p.active) : null,
    bench: p.bench.map(cloneSlot),
    globalAbilitiesUsed: p.globalAbilitiesUsed.slice(),
    revealed: p.revealed.slice(),
  };
}

function cloneDecision(d: Decision): Decision {
  const out: Decision = { ...d };
  if (d.actions) out.actions = d.actions.slice();
  if (d.values) out.values = d.values.slice();
  if (d.labels) out.labels = d.labels.slice();
  return out;
}

function cloneVal(v: unknown): unknown {
  return Array.isArray(v) ? v.slice() : v;
}

/** Deep copy. Hand-written: structuredClone is several times slower on this shape. */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    rng: [s.rng[0], s.rng[1], s.rng[2]],
    forcedCoins: s.forcedCoins.slice(),
    p: [clonePlayer(s.p[0]), clonePlayer(s.p[1])],
    stadium: s.stadium ? { ...s.stadium } : null,
    stack: s.stack.map((f) => {
      const vars: Record<string, never> = {};
      for (const k in f.vars) (vars as Record<string, unknown>)[k] = cloneVal(f.vars[k]);
      return { ...f, vars };
    }),
    pending: s.pending
      ? {
          decision: cloneDecision(s.pending.decision),
          resume: { ...s.pending.resume },
        }
      : null,
    effects: s.effects.map((e) => ({ ...e })),
    queued: s.queued.map((f) => ({ ...f, vars: { ...f.vars } })),
    limbo: s.limbo.slice(),
  };
}

export function opp(p: Player): Player {
  return (1 - p) as Player;
}

export function emit(env: Env, e: GameEvent): void {
  if (env.emit) env.emit(e);
}

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

/** Uniform float from a stream (0, 1 = decks of p0/p1, 2 = coins). */
export function rand(s: GameState, stream: 0 | 1 | 2): number {
  const [next, v] = step(s.rng[stream]);
  s.rng[stream] = next;
  return v;
}

export function shuffleDeck(env: Env, s: GameState, p: Player): void {
  const d = s.p[p].deck;
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s, p) * (i + 1));
    const t = d[i] as number;
    d[i] = d[j] as number;
    d[j] = t;
  }
  s.p[p].knownTop = 0;
  emit(env, { type: 'shuffle', player: p });
}

export function flipCoin(env: Env, s: GameState, p: Player): boolean {
  const heads = s.forcedCoins.length ? (s.forcedCoins.shift() as boolean) : rand(s, 2) < 0.5;
  emit(env, { type: 'coin_flip', player: p, heads });
  return heads;
}

// ---------------------------------------------------------------------------
// Slots and zones
// ---------------------------------------------------------------------------

export function allSlots(ps: PlayerState): Slot[] {
  return ps.active ? [ps.active, ...ps.bench] : ps.bench.slice();
}

export function findSlot(s: GameState, id: number): { slot: Slot; owner: Player; active: boolean } | null {
  for (const p of [0, 1] as Player[]) {
    const ps = s.p[p];
    if (ps.active && ps.active.id === id) return { slot: ps.active, owner: p, active: true };
    for (const b of ps.bench) if (b.id === id) return { slot: b, owner: p, active: false };
  }
  return null;
}

export function topCard(slot: Slot): number {
  return slot.cards[slot.cards.length - 1] as number;
}

export function newSlot(s: GameState, card: number): Slot {
  return {
    id: s.nextSlot++,
    cards: [card],
    energy: [],
    tools: [],
    damage: 0,
    cond: 0,
    enteredTurn: s.turn,
    evolvedTurn: 0,
    usedAbilities: [],
  };
}

/** Remove a card id from an array in place; true when found. */
export function removeFrom(arr: number[], card: number): boolean {
  const i = arr.indexOf(card);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
}

/** Take a card out of whichever hidden/public zone of its owner holds it (not from play). */
export function takeFromZones(ps: PlayerState, card: number): boolean {
  if (removeFrom(ps.hand, card)) {
    removeFrom(ps.revealed, card);
    return true;
  }
  const di = ps.deck.indexOf(card);
  if (di >= 0) {
    // Taking a card from inside the known top run shortens it; elsewhere it is unchanged.
    if (di >= ps.deck.length - ps.knownTop) ps.knownTop--;
    ps.deck.splice(di, 1);
    return true;
  }
  return removeFrom(ps.discard, card) || removeFrom(ps.prizes, card) || removeFrom(ps.lost, card);
}

/** Every card in a slot (Pokémon stack, Energy, Tools). */
export function slotCards(slot: Slot): number[] {
  return [...slot.cards, ...slot.energy, ...slot.tools];
}

export function draw(env: Env, s: GameState, p: Player, n: number): number {
  const ps = s.p[p];
  let drawn = 0;
  for (let i = 0; i < n && ps.deck.length; i++) {
    const c = ps.deck.pop() as number;
    ps.hand.push(c);
    if (ps.knownTop > 0) ps.knownTop--;
    drawn++;
    emit(env, { type: 'draw', player: p, card: c });
  }
  return drawn;
}
