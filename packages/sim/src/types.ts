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
  /**
   * A Trainer whose every effect needs its player's deck (draw, search it, take its top cards): with an
   * empty deck it would do nothing, so it can't be played (TPCi rulings 2014-11-13 and, for Ultra Ball's
   * discard being a cost rather than an effect, 2017-04-27).
   */
  needsDeck: boolean;
  stadiumCode: string | null;
  stadiumWhen: Cond | null;
  // Energy
  basicEnergy: boolean;
  provides: PType[];
  /**
   * A Special Energy whose printed text gives its Energy only "as long as this card is attached to a Pokémon": in the hand, deck or
   * discard pile it is no type of Energy, so "a {F} Energy card from your discard pile" does not find it (Compendium #668).
   */
  typeOnlyAttached?: boolean;
  // Shared passives/triggers (Tools, Stadiums, Energy)
  statics: StaticDef[];
  triggers: { t: TriggerScript; code: string }[];
  /** An Ability or card text that makes this Pokémon other types ("it is {F} and {P} type"): see StaticEffect `types`. */
  typeFix?: { types: PType[]; add: boolean; /** The type change is an Ability's (it ends while the Pokémon's Abilities are switched off), not the card's own text. */ ability: boolean; /** Only while the Pokémon matches this (a condition on the Pokémon itself: "has a Future Booster Energy Capsule attached"). */ ifSlot?: import('./dsl.js').Filter };
  /** The printed "Ancient" / "Future" tag of this PRINTING (src/cards/tags.ts), or null. See Filter `tag`. */
  tag: 'Ancient' | 'Future' | null;
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
  /** Turn it was last made Paralyzed (unset = before this game's tracking, e.g. a scenario). */
  paralyzedTurn?: number;
  /** Turn this Pokémon last moved from the Bench to the Active Spot (cleared when it evolves). */
  movedActiveTurn?: number;
  /** Turn a heal last removed damage from this Pokémon. */
  healedTurn?: number;
  /** The "Knocked Out by damage from an attack" triggers have been queued for this Pokémon's current Knock Out (see resolveKOs). */
  koTriggered?: boolean;
  /** Survival Brace-style: full-HP damage that would have Knocked it Out was dealt; its remaining HP becomes 10 when Knock Outs are checked (ruling 2041). */
  braced?: boolean;
  /** The owner's answer to "put these cards into your hand instead of the discard pile?" for this Pokémon's current Knock Out (see resolveKOs). */
  koHandAnswer?: boolean;
  /** Damage from opposing attacks this Pokémon took in turn `attackDmgTurn` (a running total for that turn). */
  attackDmgTurn?: number;
  attackDmg?: number;
  /** Damage counters Poison places at each Checkup, when not 1 (while Poisoned; every application of Poison sets or clears it). */
  poisonCounters?: number;
  /** Damage counters Burn places at each Checkup, when not 2 (while Burned; every application of Burn sets or clears it). */
  burnCounters?: number;
  /** Damage counters a failed Confusion flip places, when not 3 (while Confused; every application of Confusion sets or clears it). */
  confusionCounters?: number;
}

/** A program scheduled for the end of a turn (the `delay` step). */
export interface DelayedEffect {
  /** Compiled program key in GameContext.code. */
  code: string;
  /** The tracked Pokémon (slot id); the effect is dropped when it leaves the Active Spot, evolves or is Knocked Out. */
  slot: number;
  /** Controller of the effect. */
  player: Player;
  /** The card whose effect this is, and the Pokémon slot it came from. */
  src: number;
  from: number;
  /** Runs at the end of this turn number. */
  turn: number;
  fromAttack: boolean;
}

/** The Pokémon of one player that used an attack in turn `turn`. */
export interface AttackRecord {
  turn: number;
  slots: number[];
  cards: number[];
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
  /** This player used the Stadium now in play this turn (cleared when another Stadium is played: the use belongs to the card). */
  stadiumAbilityUsed: boolean;
  /** Names of "can't use more than 1 X Ability each turn" Abilities used this turn. */
  globalAbilitiesUsed: string[];
  /** Turn number of the most recent turn in which one of this player's Pokémon was Knocked Out. */
  lastKoTurn: number;
  /** lane:misc — the KO turn before `lastKoTurn`, so a Knock Out on your own turn (Risky Ruins) doesn't hide one from the opponent's last turn. */
  prevKoTurn?: number;
  /** lane:trevenant — the turn in which `attackKoCards` were Knocked Out by damage from an opponent's attack. */
  attackKoTurn?: number;
  /** lane:trevenant — top cards of this player's Pokémon Knocked Out by damage from an opponent's attack in `attackKoTurn`. Replaced, never mutated (clonePlayer shares it). */
  attackKoCards?: number[];
  // knowledge (for views and determinisation)
  /** The owner has looked through their deck since it was last shuffled into prizes → prizes are deducible. */
  prizesKnown: boolean;
  /** The top N cards of the deck are known to their owner (placed there face down by the owner). */
  knownTop: number;
  /** Hand cards the opponent has seen (revealed by a search), until they leave the hand. */
  revealed: number[];
  /** Cards (instance ids) this player played from their hand during their current turn by their own actions. Reset when their turn starts. */
  playedThisTurn?: number[];
  /** `prizesTaken` when this player's current turn began, and how many Prize cards they took in their most recent finished turn. */
  prizesAtTurnStart?: number;
  prizesLastTurn?: number;
  /** Top cards of this player's Pokémon Knocked Out in turn `koCardsTurn`, and in the turn before (`prevKoCardsTurn`). Replaced, never mutated. */
  koCards?: number[];
  koCardsTurn?: number;
  prevKoCards?: number[];
  prevKoCardsTurn?: number;
  /** Prize cards (instance ids) of this player turned face up: they stay so for the rest of the game, known to both players. Replace, never mutate. */
  prizesUp?: number[];
  /**
   * Which of this player's Pokémon used an attack in the turn `turn` (slot ids, and the card each was), and in the turn before
   * (`prevAttackRec`): "if 1 of your other Ancient Pokémon used an attack during your last turn". Replaced, never mutated.
   */
  attackRec?: AttackRecord;
  prevAttackRec?: AttackRecord;
  /** Tool cards (instance ids) whose once-per-turn use (Backtrack Badge's re-flip) has been spent this turn. Replace, never mutate: clones share it. */
  toolUsed?: number[];
  /** Names of "can't be applied more than once per game" effects already applied (Legacy Energy). Replace, never mutate: clones share it. */ // lane:fighting
  oncePerGame?: string[]; // lane:fighting
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
  /**
   * Queued effects that happen at the same time (damage to a Pokémon, Knock Out step 2, an Energy attach, an Evolution, Pokémon Checkup, the end
   * of the turn): `g` names the moment, `by` is the player the rulebook lets choose their order (Advanced Player's Rulebook v3.4, E-03/E-04/E-05,
   * the Energy attach entry, the Checkup steps and the end-of-turn entry). `ev` is the event instance (`GameState.ev` when the moment began):
   * only effects of the same moment, kind and chooser are ordered together. `picked`: the player has chosen this one to go next; the frame
   * keeps the rest of its identity, so the checks made when it is applied still know it belongs to its moment.
   */
  order?: { g: string; by: Player; ev: number; picked?: true };
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
  /** The first turn it applies in: "During your next turn" waits for that turn. Absent = from when it was made. */
  start?: number;
  /** Attack effects on a Pokémon end when it leaves the Active Spot or evolves. */
  fromAttack: boolean;
  src: number;
  /** The turn the effect was created in: "During your next turn" effects that care don't count it (`koPrizes` `duringTakersTurn`). */
  since?: number;
  filter?: import('./dsl.js').Filter;
  /** Player-level effect that covers that player's Pokémon (see the `effect` step's `scope`). */ // lane:metal
  scope?: import('./dsl.js').Scope;
  /** The attack that set the effect (`extraPrize` `thisAttack`): the attacking Pokémon's slot and the turn's attack number. */
  atk?: { by: number; use: number };
  /** A `react` effect: its compiled program (key in GameContext.code), the player who controls it and the Pokémon slot it came from. */
  code?: string;
  by?: Player;
  from?: number;
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
  /** Programs waiting for the end of a turn. Replace, never mutate in place. */
  delayed?: DelayedEffect[];
  /** Set when an attack resolves: the turn ends once the stack empties. */
  attacked: boolean;
  /** The Pokémon (slot id) that used the current attack and the card it was: who the attack's Knock Outs are "from". */
  attackBy?: number;
  attackByCard?: number;
  /** Slot ids the current attack has damaged (opposing Pokémon only). Replace, never mutate: clones share it. */ // lane:fighting
  attackHits?: number[]; // lane:fighting
  /** Attacks used this turn (the current player's), reset at turn start: "may attack twice" (attackTwice). */
  attackUses?: number;
  /** The first attack of this turn was one printed on an attached Tool (a Technical Machine): Festival Lead doesn't work with it. */
  attackedViaTool?: boolean;
  /** An effect ended the turn (the `endTurn` step): no further attack this turn. */
  noMoreAttacks?: boolean;
  /** The player who played the Stadium that last changed Bench sizes, kept so that when it leaves play that player discards first. */
  benchOwner?: Player;
  /** Triggered effects waiting for the stack to empty. */
  queued: Frame[];
  /** The event instance being produced (see `beginEvent`): triggers queued by it share this id, and are ordered together. */
  ev?: number;
  /** The last event id handed out: ids only ever grow, whatever `ev` is set back to. */
  evNext?: number;
  /** Queue length when the effect now running was taken from it: what is queued beyond it was caused by that effect and resolves next. */
  nest?: number;
  /** A Trainer card being played: out of the hand, not yet in the discard pile. */
  limbo: number[];
  /**
   * Prize cards still to be taken for the Knock Outs just resolved, per player, and how many each has taken so far in this batch.
   * They are taken one at a time, so a player with a face-up Prize card chooses each time (see flow.ts `takePrizes`).
   */
  prizeTaking?: { left: [number, number]; took: [number, number] };
  /** Sudden-death games started so far (both players won at once): each is a new game with 1 Prize card per player. */
  suddenDeath?: number;
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
  /** `card`: an Ability used from the hand (Klinklang): the instance id of that card; `slot` is 0 then. */
  | { t: 'ability'; slot: number; idx: number; card?: number }
  | { t: 'stadium' }
  /** `card`: an attack printed on an attached Tool (instance id of that card) that the Pokémon can use; `idx` indexes the attacks of that card. */
  | { t: 'attack'; idx: number; card?: number };

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
    /** An opening hand with no Basic Pokémon but one that may start Active (Cinderace): put it there, or mulligan. */
    | { k: 'dealChoice'; p: Player }
    | { k: 'extraBench'; p: Player }
    | { k: 'promote'; p: Player }
    /** A player with more Benched Pokémon than their Bench allows chooses which to discard. */
    | { k: 'benchDiscard'; p: Player }
    /** The owner of a Pokémon being Knocked Out decides whether some of its cards go to their hand instead of the discard pile (`koToHand`). */
    | { k: 'koHand'; slot: number }
    /** The owner of a Pokémon with more Tools than it may now have chooses which to discard. */
    | { k: 'toolDiscard'; slot: number }
    /** A player taking a Prize card while one is face up: a face-down one (when `down`, option 0) or one of the face-up cards `up`. */
    | { k: 'prizePick'; p: Player; up: number[]; down: boolean }
    /** Several effects happen at the same time and the right player chooses which goes first; `idx` are the queue positions offered, in label order. */
    | { k: 'triggerOrder'; idx: number[] };
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
  /** `checkup`: Poison/Burn at Pokémon Checkup, which no attack or Ability caused. */
  | { type: 'counters'; player: Player; slot: number; n: number; checkup?: true }
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
  | { type: 'game_end'; winner: Player | null; reason: string; turn: number }
  /** Both players won at once: a sudden-death game starts (1 Prize card each). `n` counts them in this match. */
  | { type: 'sudden_death'; n: number };

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
