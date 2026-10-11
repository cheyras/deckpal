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
    delayed: [],
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
  const out: Slot = {
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
  // Optional fields are copied only when set (no temporary objects: this runs for every Pokémon of every search clone).
  if (s.paralyzedTurn !== undefined) out.paralyzedTurn = s.paralyzedTurn;
  if (s.movedActiveTurn !== undefined) out.movedActiveTurn = s.movedActiveTurn;
  if (s.healedTurn !== undefined) out.healedTurn = s.healedTurn;
  if (s.koTriggered) out.koTriggered = true;
  if (s.koHandAnswer !== undefined) out.koHandAnswer = s.koHandAnswer;
  if (s.attackDmgTurn !== undefined) {
    out.attackDmgTurn = s.attackDmgTurn;
    out.attackDmg = s.attackDmg;
  }
  if (s.poisonCounters !== undefined) out.poisonCounters = s.poisonCounters;
  if (s.burnCounters !== undefined) out.burnCounters = s.burnCounters;
  if (s.confusionCounters !== undefined) out.confusionCounters = s.confusionCounters;
  return out;
}

const OPTIONAL_PLAYER_FIELDS = [
  'prevKoTurn',
  'attackKoTurn',
  'attackKoCards',
  'prizesAtTurnStart',
  'prizesLastTurn',
  'koCards',
  'koCardsTurn',
  'prevKoCards',
  'prevKoCardsTurn',
  'prizesUp',
  'attackRec',
  'prevAttackRec',
  'toolUsed',
  'oncePerGame',
] as const;

// Written out field by field (a `...p` spread over a shape with this many optional fields is slow, and a clone is made per search node).
function clonePlayer(p: PlayerState): PlayerState {
  const out: PlayerState = {
    deck: p.deck.slice(),
    hand: p.hand.slice(),
    discard: p.discard.slice(),
    prizes: p.prizes.slice(),
    lost: p.lost.slice(),
    active: p.active ? cloneSlot(p.active) : null,
    bench: p.bench.map(cloneSlot),
    mulligans: p.mulligans,
    prizesTaken: p.prizesTaken,
    supporterPlayed: p.supporterPlayed,
    stadiumPlayed: p.stadiumPlayed,
    energyAttached: p.energyAttached,
    retreated: p.retreated,
    stadiumAbilityUsed: p.stadiumAbilityUsed,
    globalAbilitiesUsed: p.globalAbilitiesUsed.slice(),
    lastKoTurn: p.lastKoTurn,
    prizesKnown: p.prizesKnown,
    knownTop: p.knownTop,
    revealed: p.revealed.slice(),
  };
  if (p.playedThisTurn) out.playedThisTurn = p.playedThisTurn.slice();
  // Replaced, never mutated: shared with the original.
  for (const k of OPTIONAL_PLAYER_FIELDS) if (k in p) (out as unknown as Record<string, unknown>)[k] = p[k];
  return out;
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
    ...(s.delayed ? { delayed: s.delayed.map((d) => ({ ...d })) } : {}),
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

export function flipCoin(env: Env, s: GameState, p: Player, why?: 'confusion'): boolean {
  const heads = env.replay?.coin?.(p, why) ?? (s.forcedCoins.length ? (s.forcedCoins.shift() as boolean) : rand(s, 2) < 0.5);
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

/** Heal a Pokémon. Records the turn when damage was actually removed ("was healed during this turn"). Returns the damage removed. */
export function healSlot(s: GameState, slot: Slot, amount: number): number {
  const removed = Math.max(0, Math.min(slot.damage, amount));
  if (removed > 0) {
    slot.damage -= removed;
    slot.healedTurn = s.turn;
  }
  return removed;
}

/** A Pokémon left the Active Spot, evolved or was Knocked Out: attack effects on it (timed and delayed) end. */
export function clearAttackEffects(s: GameState, slotId: number): void {
  s.effects = s.effects.filter((x) => !(x.slot === slotId && x.fromAttack));
  if (s.delayed?.length) s.delayed = s.delayed.filter((d) => !(d.slot === slotId && d.fromAttack));
}

/** Remove a card id from an array in place; true when found. */
export function removeFrom(arr: number[], card: number): boolean {
  const i = arr.indexOf(card);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
}

/**
 * Take a card out of its owner's hand. Its `revealed` marker goes with it: a marker
 * means "the opponent knows this card is in hand NOW", so it must not survive the card
 * leaving (or it would leak the card's identity if it is later drawn back secretly).
 */
export function leaveHand(ps: PlayerState, card: number): boolean {
  if (!removeFrom(ps.hand, card)) return false;
  removeFrom(ps.revealed, card);
  return true;
}

/**
 * A card leaves the Prize zone: it stops being a face-up Prize (`prizesUp` lists only cards that are face up Prizes NOW, so no
 * stale entry can pin a card that has since been shuffled or drawn). Returns true when it was face up, i.e. known to both players.
 * `prizesUp` is replaced, never mutated: clones share the array.
 */
export function leavePrizeZone(ps: PlayerState, card: number): boolean {
  if (!ps.prizesUp?.includes(card)) return false;
  ps.prizesUp = ps.prizesUp.filter((c) => c !== card);
  return true;
}

/** Take a card out of whichever hidden/public zone of its owner holds it (not from play). */
export function takeFromZones(ps: PlayerState, card: number): boolean {
  if (leaveHand(ps, card)) return true;
  const di = ps.deck.indexOf(card);
  if (di >= 0) {
    // Taking a card from inside the known top run shortens it; elsewhere it is unchanged.
    if (di >= ps.deck.length - ps.knownTop) ps.knownTop--;
    ps.deck.splice(di, 1);
    return true;
  }
  if (removeFrom(ps.prizes, card)) {
    leavePrizeZone(ps, card);
    return true;
  }
  return removeFrom(ps.discard, card) || removeFrom(ps.lost, card);
}

/** Every card in a slot (Pokémon stack, Energy, Tools). */
export function slotCards(slot: Slot): number[] {
  return [...slot.cards, ...slot.energy, ...slot.tools];
}

/** Log replay: take the card a replay hook picked out of `zone`; undefined when it picked none (or one not there). */
export function takePicked(zone: number[], pick: number | undefined): number | undefined {
  if (pick === undefined) return undefined;
  return removeFrom(zone, pick) ? pick : undefined;
}

export function draw(env: Env, s: GameState, p: Player, n: number): number {
  const ps = s.p[p];
  let drawn = 0;
  for (let i = 0; i < n && ps.deck.length; i++) {
    const c = takePicked(ps.deck, env.replay?.draw?.(p, ps.deck)) ?? (ps.deck.pop() as number);
    ps.hand.push(c);
    removeFrom(ps.revealed, c); // a secret draw: whatever the opponent knew about this card is stale
    if (ps.knownTop > 0) ps.knownTop--;
    drawn++;
    emit(env, { type: 'draw', player: p, card: c });
  }
  return drawn;
}
