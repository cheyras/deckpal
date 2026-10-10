import type {
  AbilityScript,
  CardScript,
  Cond,
  PType,
  StaticDef,
  StaticEffect,
  TriggerScript,
} from './dsl.js';

export type { PType } from './dsl.js';
export type Player = 0 | 1;

// ---------------------------------------------------------------------------
// Card data
// ---------------------------------------------------------------------------

/** A printed card as the DeckPal catalog serves it (`GET /api/cards/:id`, the `card` object). */
export interface CardFrame {
  cardId: string;
  name: string;
  category: 'Pokemon' | 'Trainer' | 'Energy';
  hp?: number | null;
  stage?: string | null;
  suffix?: string | null;
  evolvesFrom?: string | null;
  trainerType?: string | null;
  energyType?: string | null;
  retreat?: number | null;
  types?: string[];
  effect?: string | null;
  regulationMark?: string | null;
  attacks?: { name: string; cost: string | null; damage: string | null; effect: string | null }[];
  abilities?: { kind: string; name: string; effect: string }[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
}

export interface AttackDef {
  name: string;
  cost: PType[];
  /** The printed number (0 when none). */
  baseDamage: number;
  /** '+', '×', '-' suffix on the printed number, or ''. */
  damageSuffix: string;
  text: string;
  /** Compiled program key in GameContext.code. */
  code: string;
}

export interface AbilityDef {
  name: string;
  text: string;
  script?: AbilityScript;
  /** Compiled program key for an activated Ability. */
  code?: string;
}

/**
 * How well the engine plays a card:
 * - full: every printed effect is implemented and tested.
 * - vanilla: there is no effect text, so the frame alone defines the card.
 * - approx: a Pokémon with effect text that is not yet scripted; its attacks deal
 *   their printed damage and every effect and Ability is ignored.
 * - none: an unscripted Trainer or Special Energy; it can't be played.
 */
export type Coverage = 'full' | 'vanilla' | 'approx' | 'none';

export interface CardDef {
  idx: number;
  id: string;
  name: string;
  kind: 'pokemon' | 'trainer' | 'energy';
  coverage: Coverage;
  // Pokémon
  hp: number;
  stage: 0 | 1 | 2;
  evolvesFrom: string | null;
  types: PType[];
  weakness: PType | null;
  resistance: { type: PType; amount: number } | null;
  retreat: number;
  ruleBox: boolean;
  ex: boolean;
  mega: boolean;
  tera: boolean;
  prizeValue: number;
  attacks: AttackDef[];
  abilities: AbilityDef[];
  // Trainer
  ttype: 'item' | 'supporter' | 'stadium' | 'tool' | null;
  aceSpec: boolean;
  playCode: string | null;
  playable: Cond | null;
  stadiumCode: string | null;
  stadiumWhen: Cond | null;
  // Energy
  basicEnergy: boolean;
  provides: PType[];
  // Shared passives/triggers (Tools, Stadiums, Energy)
  statics: StaticDef[];
  triggers: { t: TriggerScript; code: string }[];
  /** Printed text, joined, for the round-trip check and the debug view. */
  text: string;
  script: CardScript | null;
}

// ---------------------------------------------------------------------------
// Game state -- plain, JSON-serialisable data
// ---------------------------------------------------------------------------

export const ASLEEP = 1;
export const CONFUSED = 2;
export const PARALYZED = 4;
export const POISONED = 8;
export const BURNED = 16;
/** Asleep, Confused and Paralyzed replace each other. */
export const ROTATION = ASLEEP | CONFUSED | PARALYZED;

export interface Slot {
  /** Stable id for the life of this Pokémon in play. */
  id: number;
  /** Evolution stack, bottom (Basic) first; the last card is the Pokémon. */
  cards: number[];
  energy: number[];
  tools: number[];
  damage: number;
  /** Special Conditions bitmask. */
  cond: number;
  /** Turn this Pokémon came into play. */
  enteredTurn: number;
  /** Turn it last evolved (0 = never). */
  evolvedTurn: number;
  /** Activated Abilities used this turn (ability index), reset each turn. */
  usedAbilities: number[];
}

export interface PlayerState {
  /** Deck, TOP = LAST element. */
  deck: number[];
  hand: number[];
  discard: number[];
  prizes: number[];
  lost: number[];
  active: Slot | null;
  bench: Slot[];
  mulligans: number;
  prizesTaken: number;
  // per-turn flags
  supporterPlayed: boolean;
  stadiumPlayed: boolean;
  energyAttached: boolean;
  retreated: boolean;
  stadiumAbilityUsed: boolean;
  /** Names of "can't use more than 1 X Ability each turn" Abilities used this turn. */
  globalAbilitiesUsed: string[];
  /** Turn number of the most recent turn in which one of this player's Pokémon was Knocked Out. */
  lastKoTurn: number;
  /** lane:misc — the KO turn before `lastKoTurn`, so a Knock Out on your own turn (Risky Ruins) doesn't hide one from the opponent's last turn. */
  prevKoTurn?: number;
  // knowledge (for views and determinisation)
  /** The owner has looked through their deck since it was last shuffled into prizes → prizes are deducible. */
  prizesKnown: boolean;
  /** The top N cards of the deck are known to their owner (placed there face down by the owner). */
  knownTop: number;
  /** Hand cards the opponent has seen (revealed by a search), until they leave the hand. */
  revealed: number[];
}

/** An interpreter frame: a program partway through. */
export interface Frame {
  code: string;
  pc: number;
  vars: Record<string, Val>;
  /** Controller of the effect. */
  player: Player;
  /** The card whose effect this is. */
  src: number;
  /** The Pokémon slot the effect comes from (attacker / Ability user / Tool or Energy holder). */
  slot: number;
  kind: 'attack' | 'ability' | 'trainer' | 'energy' | 'tool' | 'stadium' | 'trigger' | 'rule';
}

export type Val = number | boolean | number[] | null;

export interface TimedEffect {
  static: StaticEffect;
  /** A slot id, or -1 for a player-level effect. */
  slot: number;
  /** For player-level effects: the affected player. */
  player: Player;
  /** The effect lasts through the END of this turn number. */
  until: number;
  /** Attack effects on a Pokémon end when it leaves the Active Spot or evolves. */
  fromAttack: boolean;
  src: number;
  filter?: import('./dsl.js').Filter;
  /** Player-level effect that covers that player's Pokémon (see the `effect` step's `scope`). */ // lane:metal
  scope?: import('./dsl.js').Scope;
}

export type Phase = 'setup' | 'main' | 'over';

export interface GameState {
  v: 1;
  seed: number;
  /** RNG stream states: [deck of player 0, deck of player 1, coins]. */
  rng: [number, number, number];
  /** Forced coin results (log replay, search): consumed before the coin stream. */
  forcedCoins: boolean[];
  turn: number;
  current: Player;
  first: Player;
  phase: Phase;
  /** Flow position inside the current phase (see flow.ts). */
  step: string;
  p: [PlayerState, PlayerState];
  nextSlot: number;
  stadium: { card: number; owner: Player } | null;
  stack: Frame[];
  pending: Pending | null;
  effects: TimedEffect[];
  /** Set when an attack resolves: the turn ends once the stack empties. */
  attacked: boolean;
  /** Triggered effects waiting for the stack to empty. */
  queued: Frame[];
  /** A Trainer card being played: out of the hand, not yet in the discard pile. */
  limbo: number[];
  /** Where the flow continues once Knock Outs and promotions are resolved. */
  afterKo: string;
  winner: Player | null;
  draw: boolean;
  winReason: string | null;
  /** Count of engine steps taken (actions + interpreter ops), for limits and benchmarks. */
  steps: number;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type Action =
  | { t: 'end' }
  | { t: 'bench'; card: number }
  | { t: 'evolve'; card: number; slot: number }
  | { t: 'attach'; card: number; slot: number }
  | { t: 'trainer'; card: number }
  | { t: 'tool'; card: number; slot: number }
  | { t: 'retreat' }
  | { t: 'ability'; slot: number; idx: number }
  | { t: 'stadium' }
  | { t: 'attack'; idx: number };

export type DecisionKind =
  | 'main'
  | 'goFirst'
  | 'setupActive'
  | 'setupBench'
  | 'mulliganDraws'
  | 'promote'
  | 'cards'
  | 'slots'
  | 'option'
  | 'yesno'
  | 'order';

/**
 * Every decision has one shape: pick between `min` and `max` of the numbered
 * options. The list IS the legal-move list; nothing else can be submitted.
 */
export interface Decision {
  player: Player;
  kind: DecisionKind;
  prompt: string;
  min: number;
  max: number;
  /** main: Action per option. */
  actions?: Action[];
  /** cards/order: card instance ids. slots/promote/setup: slot ids or card ids (see kind). */
  values?: number[];
  /** option/yesno/goFirst/mulliganDraws: labels. */
  labels?: string[];
}

export interface Pending {
  decision: Decision;
  /** How the engine applies the answer. */
  resume:
    | { k: 'frame'; as: string; mode: 'cards' | 'slots' | 'index' | 'bool' | 'order' }
    | { k: 'main' }
    | { k: 'goFirst' }
    | { k: 'setupActive'; p: Player }
    | { k: 'setupBench'; p: Player }
    | { k: 'mulliganDraws'; p: Player }
    | { k: 'promote'; p: Player };
}

// ---------------------------------------------------------------------------
// Events -- the battle_events vocabulary from the battle-intel roadmap
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'coin_toss'; winner: Player }
  | { type: 'go_first'; player: Player }
  | { type: 'mulligan'; player: Player; hand: number[] }
  | { type: 'opening_hand'; player: Player; size: number }
  | { type: 'turn_start'; player: Player; turn: number }
  | { type: 'draw'; player: Player; card: number }
  | { type: 'play_to_bench'; player: Player; card: number; slot: number }
  | { type: 'play_to_active'; player: Player; card: number; slot: number }
  | { type: 'evolve'; player: Player; card: number; slot: number }
  | { type: 'attach'; player: Player; card: number; slot: number }
  | { type: 'play_trainer'; player: Player; card: number }
  | { type: 'play_stadium'; player: Player; card: number }
  | { type: 'use_ability'; player: Player; slot: number; name: string }
  | { type: 'attack'; player: Player; slot: number; name: string }
  | { type: 'damage'; player: Player; slot: number; amount: number; bySlot: number }
  | { type: 'counters'; player: Player; slot: number; n: number }
  | { type: 'knockout'; player: Player; slot: number; card: number }
  | { type: 'prize_take'; player: Player; n: number }
  | { type: 'promote'; player: Player; slot: number }
  | { type: 'retreat'; player: Player; from: number; to: number }
  | { type: 'switch'; player: Player; from: number; to: number }
  | { type: 'shuffle'; player: Player }
  | { type: 'search'; player: Player; found: number[] }
  | { type: 'discard'; player: Player; cards: number[] }
  | { type: 'coin_flip'; player: Player; heads: boolean }
  | { type: 'condition'; player: Player; slot: number; cond: string }
  | { type: 'end_turn'; player: Player; turn: number }
  | { type: 'game_end'; winner: Player | null; reason: string; turn: number };

export interface EngineOptions {
  /** Record events (off by default in batch simulation). */
  events?: boolean;
  /** Force who goes first (skips the coin flip decision). */
  first?: Player;
  /** Hard cap on turns; the game is recorded as a draw ('turn limit'). */
  maxTurns?: number;
  /** Extra scripts matched by card id (tests, or a script under review). Win over the registry. */
  scripts?: import('./dsl.js').CardScript[];
}
