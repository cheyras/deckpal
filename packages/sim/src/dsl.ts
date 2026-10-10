/**
 * The card-effect vocabulary.
 *
 * A card's behaviour is DATA composed from the clauses below -- never code that
 * waits in memory. Programs are compiled to a flat op list (compile.ts) and run
 * by an interpreter whose program counter and variables live in the game state,
 * so an effect halfway through ("choose up to 2 Basic Pokémon...") can be saved,
 * cloned for search and replayed.
 *
 * Changing this file changes every card that uses a clause. It is engine code:
 * extend it deliberately, with a rule or card test for the new clause.
 */

export type PType =
  | 'Grass'
  | 'Fire'
  | 'Water'
  | 'Lightning'
  | 'Psychic'
  | 'Fighting'
  | 'Darkness'
  | 'Metal'
  | 'Dragon'
  | 'Colorless'
  | 'Fairy';

export type Who = 'self' | 'opp';
export type SpecialCondition = 'asleep' | 'confused' | 'paralyzed' | 'poisoned' | 'burned';

/** A filter over cards (in any zone) or over Pokémon in play (matched on the top card). */
export interface Filter {
  cat?: 'pokemon' | 'trainer' | 'energy';
  stage?: 'basic' | 'stage1' | 'stage2' | 'evolution';
  ruleBox?: boolean;
  ex?: boolean;
  mega?: boolean;
  tera?: boolean;
  type?: PType | PType[];
  hpMax?: number;
  ttype?: 'item' | 'supporter' | 'stadium' | 'tool';
  basicEnergy?: boolean;
  /** Basic Energy of this type (or the Energy type a Basic Energy card provides). */
  energyType?: PType;
  name?: string | string[];
  /** Card name contains this text (e.g. "Colress"). */
  nameIncludes?: string;
  /** Pokémon whose printed Abilities include this name (e.g. "Hide 'n' Sneak"). */
  hasAbility?: string;
  /** In-play only: the Pokémon has at least one damage counter. */
  damaged?: boolean;
  /** In-play only: at least one attached Energy card matches (e.g. `{ basicEnergy: false }` = has Special Energy). */ // lane:metal
  energy?: Filter;
  /** In-play only: the Pokémon has a Tool attached (true) / none (false). */ // lane:metal
  tool?: boolean;
  /** In-play only: the Pokémon has this Special Condition. */ // lane:metal
  condition?: SpecialCondition;
  not?: Filter;
  any?: Filter[];
}

/** Where a set of cards is chosen from. */
export type CardZone = 'hand' | 'deck' | 'discard' | 'prizes' | 'lost';

/** Where a set of Pokémon in play is chosen from, relative to the effect's controller. */
export type SlotZone =
  | 'myActive'
  | 'myBench'
  | 'myPokemon'
  | 'oppActive'
  | 'oppBench'
  | 'oppPokemon'
  | 'allPokemon';

/**
 * A single Pokémon in play.
 * - 'self': the Pokémon whose attack/Ability this is (for a Tool or Energy: the Pokémon it is attached to).
 * - 'defender': the opponent's Active Pokémon as it was when the attack was declared.
 * - {v}: the (first) slot stored in a variable by an earlier `chooseSlots`.
 */
export type SlotRef = 'self' | 'defender' | 'myActive' | 'oppActive' | { v: string };

/** Destination for moved cards. 'bench' puts Basic Pokémon into play. */
export type Dest = 'hand' | 'discard' | 'deckTop' | 'deckBottom' | 'deck' | 'bench' | 'lost';

export type Expr =
  | number
  | { v: string } // number variable, or length of a card/slot list variable
  | { len: string }
  | { count: { zone: CardZone; who?: Who; filter?: Filter } }
  | { pokemon: { zone: SlotZone; filter?: Filter } }
  | { prizesLeft: Who }
  | { prizesTaken: Who }
  | { energyOn: SlotRef; type?: PType }
  | { countersOn: SlotRef }
  | { handSize: Who }
  | { deckSize: Who }
  | { add: Expr[] }
  | { sub: [Expr, Expr] }
  | { mul: [Expr, Expr] }
  | { min: Expr[] }
  | { max: Expr[] }
  | { cond: Cond; then: Expr; else: Expr };

export type Cond =
  | { gte: [Expr, Expr] }
  | { gt: [Expr, Expr] }
  | { lte: [Expr, Expr] }
  | { lt: [Expr, Expr] }
  | { eq: [Expr, Expr] }
  | { and: Cond[] }
  | { or: Cond[] }
  | { not: Cond }
  /** Every card in the variable matches (false for an empty variable). */
  | { cardIs: { v: string; filter: Filter } }
  /** The referenced Pokémon matches. */
  | { slotIs: { ref: SlotRef; filter: Filter } }
  | { inActive: SlotRef }
  | { onBench: SlotRef }
  /** Any of this side's Pokémon were Knocked Out during the opponent's last turn. */
  | { koLastTurn: Who }
  | { stadium: Filter | true }
  | { benchFull: Who }
  | { firstTurn: true };

/** A passive effect, from an Ability, a Tool, a Stadium, an Energy or a timed effect. */
export type StaticEffect =
  /** Prevent effects (not damage) of the opponent's attacks/Abilities done to the affected Pokémon. */
  | { k: 'preventEffects'; from: ('attack' | 'ability')[] }
  /** Prevent damage (and optionally effects) from the opponent's attacks done to the affected Pokémon. */
  | { k: 'preventDamage'; andEffects?: boolean }
  /** Add to (or with `set`, replace) the affected Pokémon's Retreat Cost. */
  | { k: 'retreatCost'; delta?: number; set?: number }
  /** Change the Colorless part of one (or every) attack's cost on the affected Pokémon. */
  | { k: 'attackCostC'; delta: Expr; attack?: string }
  /** Replace one attack's whole cost on the affected Pokémon. */
  | { k: 'attackCostSet'; attack: string; cost: PType[] }
  /** The affected Pokémon's Weakness becomes this type (×2). */
  | { k: 'weaknessType'; type: PType }
  /** Damage the affected Pokémon's attacks do to the opponent's Active Pokémon (before W/R). */
  | { k: 'damageOut'; amount: number; vs?: Filter }
  /** Damage the affected Pokémon takes from attacks (after W/R; negative = reduction). `fromOpp`: only from the opponent's attacks. */
  | { k: 'damageIn'; amount: number; fromOpp?: boolean /* lane:metal */ }
  | { k: 'hp'; delta: number }
  | { k: 'cantAttack' }
  | { k: 'cantRetreat' }
  /** The affected Pokémon have no Abilities (other than this source's own). */
  | { k: 'noAbilities' }
  /** The affected player can't play Item cards. */
  | { k: 'itemLock' }
  /** Damage counters on Pokémon can't be moved (Watchful Eye). */
  | { k: 'countersFixed' }
  // lane:misc — Togekiss, Wonder Kiss: "When your opponent's Active Pokémon is Knocked Out, (flip a coin. If heads,)
  // take 1 more Prize card." Player-level (scope 'me'); never stacks.
  | { k: 'extraPrize'; flip?: boolean }
  // lane:misc — Psyduck, Damp: the affected Pokémon lose any Ability that Knocks Out the Pokémon using it
  // (AbilityScript.selfKo, else detected from the printed text "this Pokémon is Knocked Out").
  | { k: 'loseSelfKoAbilities' };

/** Which Pokémon a static effect applies to, relative to its source's controller. */
export type Scope =
  | 'self'
  | 'myActive'
  | 'myBench'
  | 'myPokemon'
  | 'oppActive'
  | 'oppBench'
  | 'oppPokemon'
  | 'allPokemon'
  /** Player-level effects (itemLock, countersFixed): the controller / the opponent / both. */
  | 'me'
  | 'opp'
  | 'both';

export interface StaticDef {
  effect: StaticEffect;
  scope: Scope;
  /** Only affected Pokémon matching this. */
  filter?: Filter;
  /** Only while this holds (evaluated from the source's point of view). */
  when?: Cond;
}

export type Duration = 'thisTurn' | 'oppNextTurn' | 'myNextTurn';

export type Step =
  /** Choose cards from a zone. Searching the deck lets the chooser see it. */
  | {
      op: 'chooseCards';
      from: CardZone;
      who?: Who;
      filter?: Filter;
      min: Expr;
      max: Expr;
      as: string;
      chooser?: Who;
      /** Exclude the card being played (Ultra Ball's "2 OTHER cards"). */
      others?: boolean;
      /** One card of each listed filter at most (Secret Box). Overrides filter/min/max. */
      oneEach?: Filter[];
      /** The chosen cards are revealed to the opponent. */
      reveal?: boolean;
      prompt?: string;
    }
  /** Choose Pokémon in play. */
  | {
      op: 'chooseSlots';
      from: SlotZone;
      filter?: Filter;
      min: Expr;
      max: Expr;
      as: string;
      chooser?: Who;
      prompt?: string;
    }
  /** Choose one of N labelled options; the index lands in `as`. */
  | { op: 'chooseOption'; options: string[]; as: string; chooser?: Who; prompt?: string }
  /** Move the cards in a variable (or the whole hand, or the top N of the deck) somewhere. */
  | {
      op: 'move';
      cards: string | { top: Expr; who?: Who } | { all: CardZone; who?: Who };
      to: Dest;
      who?: Who;
      /** Store the moved cards in this variable. */
      as?: string;
    }
  /** Put cards from a variable on top of the deck in an order the controller picks. */
  | { op: 'putOnTop'; cards: string }
  | { op: 'draw'; n: Expr; who?: Who }
  | { op: 'shuffle'; who?: Who }
  /** Attach the Energy cards in `cards` to the Pokémon in `to`. */
  | { op: 'attach'; cards: string; to: SlotRef }
  /** Discard Energy from a Pokémon: all of it, or `count` chosen by the controller. */
  | { op: 'discardEnergy'; from: SlotRef; count: Expr | 'all'; filter?: Filter; as?: string }
  /** Attack damage, through Weakness, Resistance and every modifier. */
  | { op: 'damage'; amount: Expr; to?: SlotRef | { each: SlotZone; filter?: Filter } | { v: string } }
  /** Place damage counters: no Weakness, Resistance or damage modifiers. */
  | { op: 'counters'; n: Expr; to: SlotRef | { each: SlotZone; filter?: Filter } }
  | { op: 'heal'; amount: Expr; to: SlotRef }
  | { op: 'condition'; cond: SpecialCondition; to: SlotRef }
  /** Switch the Active Pokémon of `who` with one of their Benched Pokémon. */
  | { op: 'switch'; who: Who; chooser?: Who; with?: SlotRef }
  /** Flip coins; heads count lands in `as`. 'untilTails' flips until a tails. */
  | { op: 'flip'; n: Expr | 'untilTails'; as: string }
  | { op: 'set'; v: string; value: Expr }
  | { op: 'if'; cond: Cond; then: Step[]; else?: Step[] }
  | { op: 'repeat'; n: Expr; body: Step[] }
  /** "You may ..." -- a yes/no decision for the controller. */
  | { op: 'may'; body: Step[]; prompt?: string }
  /** Create a timed effect on a Pokémon or a player. */
  | {
      op: 'effect';
      static: StaticEffect;
      on?: SlotRef;
      onPlayer?: Who;
      duration: Duration;
      filter?: Filter;
      /** Player-level effect on Pokémon (Iron Defender: "all of your {M} Pokémon ... includes new Pokémon"): which of `onPlayer`'s Pokémon it covers, matched live. */ // lane:metal
      scope?: Scope;
    }
  | { op: 'knockOut'; target: SlotRef }
  /** Choose one of the attacks of the (Pokémon) card in the variable and use it as this attack. */
  | { op: 'useAttackOf'; card: string }
  /** Escape hatch for genuinely bespoke effects: a named, tested function in customs.ts. */
  | { op: 'custom'; fn: string; args?: Record<string, unknown> }
  | { op: 'end' };

export type Program = Step[];

/** How a card definition's damage number is computed (default: the printed number). */
export interface AttackScript {
  /** Steps before damage (costs paid by the attack, coin flips that set damage). */
  pre?: Program;
  /** Base damage expression; defaults to the printed number (e.g. "30+" → 30). */
  damage?: Expr;
  /** Where the attack's damage goes. Defaults to the Defending Pokémon. */
  target?: SlotRef | { each: SlotZone; filter?: Filter } | { v: string };
  /** Steps after damage. */
  post?: Program;
  /** Replace the whole sequence (damage op included) with this program. */
  program?: Program;
}

export type TriggerOn =
  /** An Energy card attached from hand (fires for the Energy card's own script). */
  | 'attachFromHand'
  /** This Pokémon was put onto the Bench from hand. */
  | 'playToBench'
  /** This Pokémon evolved from a card played from hand. */
  | 'evolveFromHand'
  /** This Pokémon (or, for a Tool, the Pokémon it is attached to) was damaged by an opponent's attack while Active. */
  | 'damagedByAttackActive'
  /** This Pokémon was Knocked Out by damage from an opponent's attack. */
  | 'knockedOutByAttack'
  /** lane:misc — "During Pokémon Checkup": fires for every Pokémon in play (Abilities, Tools, Energy) at each Checkup. */
  | 'checkup'
  /** lane:misc — "At the end of your turn": the current player's Pokémon (Abilities, Tools, attached Energy), after any attack, before Checkup. */
  | 'endOfTurn'
  /** lane:misc — Stadium: a Pokémon was put onto its owner's Bench during that player's turn (frame slot = that Pokémon). */
  | 'pokemonBenched';

export interface TriggerScript {
  on: TriggerOn;
  /** Must hold at the moment the trigger fires. */
  when?: Cond;
  /** "you may": the controller decides whether it resolves. */
  optional?: boolean;
  program: Program;
}

export interface AbilityScript {
  name: string;
  /** lane:misc — the Ability Knocks Out the Pokémon using it (Damp). Default: detected from the printed text. */
  selfKo?: boolean;
  /** Activated ("Once during your turn, you may...") */
  activated?: {
    program: Program;
    /** Usable at most once per turn per Pokémon (default true). */
    oncePerTurn?: boolean;
    /** "You can't use more than 1 X Ability each turn." */
    globalOncePerTurn?: boolean;
    /** Only usable while this holds. */
    when?: Cond;
    /** Only usable while this Pokémon is in the Active Spot. */
    activeOnly?: boolean;
  };
  statics?: StaticDef[];
  triggers?: TriggerScript[];
}

/**
 * One card's behaviour, keyed by the card's id and checked against its printed
 * text (see cards/registry.ts). Everything a card can do that is not in its
 * printed frame (HP, cost, damage number, Weakness...) is written here.
 */
export interface CardScript {
  /** Canonical card id (TCGdex), e.g. "me05-039". Other printings with identical text resolve here too. */
  id: string;
  name: string;
  /** Per-attack scripts, by attack name. Attacks without effect text need none. */
  attacks?: Record<string, AttackScript>;
  abilities?: AbilityScript[];
  /** Trainer: what playing it does. */
  play?: Program;
  /** Trainer: it can only be played when this holds. */
  playable?: Cond;
  /** Supporter: "If you go first, you may use this card during your first turn." (Carmine) */ // lane:metal
  firstTurnSupporter?: boolean;
  /** Trainer (Tool/Stadium) and Energy passives. */
  statics?: StaticDef[];
  /** Trainer (Tool) and Energy triggers. */
  triggers?: TriggerScript[];
  /** Stadium: "Once during each player's turn, that player may ..." */
  stadiumAbility?: { program: Program; when?: Cond };
  /** Energy: the Energy it provides while attached (default: a Basic Energy's own type). */
  provides?: PType[];
  /** lane:misc — Energy: provides this instead while the Pokémon it is attached to matches (Ignition Energy on an Evolution Pokémon). */
  providesIf?: { filter: Filter; provides: PType[] };
  /** Energy: when discarded by an effect of the attached Pokémon's own attack, reattach it after attacking (Boomerang Energy). */
  reattachAfterOwnAttack?: boolean;
  /** Data corrections where the catalog is wrong (e.g. TCGdex marks some Special Energy "Normal"). */
  fix?: {
    specialEnergy?: boolean;
    aceSpec?: boolean;
    tera?: boolean;
    /** lane:misc — the catalog lists no "evolves from" for this Stage 1/2 card (TCGdex 30th-123 Hisuian Zoroark). */
    evolvesFrom?: string;
  };
  /** Free-text notes: rulings consulted, open questions. */
  notes?: string;
  /** Ruling status of the definition. */
  status?: 'implemented' | 'needs_ruling';
}
