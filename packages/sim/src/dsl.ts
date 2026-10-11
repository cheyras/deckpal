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
  /**
   * An Energy card that provides this type where it is attached: Basic or Special, including one that
   * provides every type (Legacy Energy). "{M} Energy" on a card means this, not only Basic {M} Energy
   * (Dewgong's Wash Out ruling, TPCi 2026-03-26: "as long as the Energy card is providing {W} Energy").
   */
  providesType?: PType;
  name?: string | string[];
  /** Card name contains this text (e.g. "Colress"). */
  nameIncludes?: string;
  /** Pokémon whose printed Abilities include this name (e.g. "Hide 'n' Sneak"). */
  hasAbility?: string;
  /** Pokémon whose printed attacks include one with this name (any of these names), e.g. "Round". Matched on the top card. */
  hasAttack?: string | string[];
  /**
   * Pokémon that have any Ability printed on them ("attacks from your opponent's Pokémon that have an Ability"). Used as an
   * `attacker` filter it also requires that the attacker's Abilities are not switched off right now (TPCi Rules Team
   * 2025-11-13, ruling 2260: under Team Rocket's Watchtower a {C} Pokémon "has no Abilities").
   */
  anyAbility?: boolean;
  /** In-play only: the Pokémon has at least one damage counter. */
  damaged?: boolean;
  /** In-play only: at least one attached Energy card matches (e.g. `{ basicEnergy: false }` = has Special Energy). */ // lane:metal
  energy?: Filter;
  /** In-play only: the Pokémon has a Tool attached (true) / none (false). */ // lane:metal
  tool?: boolean;
  /** In-play only: the Pokémon has this Special Condition. */ // lane:metal
  condition?: SpecialCondition;
  /** In-play only: the Pokémon has at least one Energy attached. */ // lane:ghost
  energized?: boolean;
  /**
   * The card has this tag ("Ancient Pokémon", "Future Supporter card"). A tag is printed on the card but is in no frame, so it is
   * looked up per PRINTING (src/cards/tags.ts): an untagged reprint of the same name does not match. Pokémon, Trainers and Energy,
   * in every zone.
   */
  tag?: 'Ancient' | 'Future';
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
  /** Prize cards that player took during their own most recent turn (0 if none). On your turn, `opp` is the opponent's last turn. */
  | { prizesTakenLastTurn: Who }
  /**
   * Damage the referenced Pokémon took from attacks of the opponent's Pokémon during the opponent's last turn (0 if none).
   * Damage counters placed by an effect are not damage (TPCi Rules Team 2025-11-13, ruling 2253); the record stays with the
   * Pokémon through a swap of its cards (ruling 2372).
   */
  | { damageTakenLastTurn: SlotRef }
  /**
   * Energy attached to a Pokémon, counted in units provided ("for each Energy attached": a card
   * providing {C}{C}{C} counts 3; one providing every type counts for `type`). `cards: true` counts
   * Energy CARDS instead, for text that says "Energy card(s)".
   */
  | { energyOn: SlotRef; type?: PType; cards?: boolean }
  | { countersOn: SlotRef }
  | { handSize: Who }
  | { deckSize: Who }
  /** Open spaces on that player's Bench: how many more Pokémon it can hold (5, or more under a `benchSize` effect, less those there). */
  | { benchRoom: Who }
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
  /**
   * The referenced Pokémon moved from the Bench to the Active Spot (switch, retreat, promotion) during the current turn.
   * It must have happened during this turn (not at the end of the opponent's turn or at Checkup), and evolving afterwards
   * resets it (TPCi Rules Team 2025-12-04, ruling 2265, Mega Lopunny ex Gale Thrust).
   */
  | { movedToActiveThisTurn: SlotRef }
  /**
   * The referenced Pokémon was healed during the current turn: a heal that actually removed damage counters.
   * Moving damage counters is not healing (TPCi Rules Team 2026-07-16, ruling 2405).
   */
  | { healedThisTurn: SlotRef }
  | { inActive: SlotRef }
  | { onBench: SlotRef }
  /** Any of this side's Pokémon (matching `filter`, if given: the card it was when Knocked Out) were Knocked Out during the opponent's last turn. */
  | { koLastTurn: Who; filter?: Filter }
  /**
   * That player played a card matching `filter` from their hand during the current turn (`who`: default the effect's controller).
   * Cards put into play by the player's own actions count: Trainers (Items, Supporters, Stadiums, Tools), Pokémon (benched or
   * evolved) and Energy attached from the hand. Cards moved by an effect do not.
   */
  | { playedThisTurn: { filter: Filter; who?: Who } }
  /** A Stadium is in play (matching `Filter`); with `of`, one that player played ("if your opponent has a Stadium in play"). */
  | { stadium: Filter | true; of?: Who }
  | { benchFull: Who }
  | { firstTurn: true }
  /** lane:ghost — a named, tested predicate registered with `registerCustomCond` (customs.ts). */
  | { custom: string; args?: Record<string, unknown> };

/** A passive effect, from an Ability, a Tool, a Stadium, an Energy or a timed effect. */
export type StaticEffect =
  /** Prevent effects (not damage) of the opponent's attacks/Abilities done to the affected Pokémon. */
  | { k: 'preventEffects'; from: ('attack' | 'ability')[] }
  /** Prevent damage (and optionally effects) from the opponent's attacks done to the affected Pokémon. */
  | {
      k: 'preventDamage';
      andEffects?: boolean;
      /** Only damage from attacks of an attacking Pokémon matching this ("attacks from Basic Pokémon"). Honoured for damage only, not with `andEffects`. */
      attacker?: Filter;
      /** lane:ghost — only from attacking Pokémon with at most this much Energy attached (Bastiodon, Ancient Bulwark). */
      attackerMaxEnergy?: number;
    }
  /** Add to (or with `set`, replace) the affected Pokémon's Retreat Cost. */
  | { k: 'retreatCost'; delta?: number; set?: number }
  /** Change the Colorless part of one (or every) attack's cost on the affected Pokémon. */
  | { k: 'attackCostC'; delta: Expr; attack?: string }
  /** Replace one attack's whole cost on the affected Pokémon. */
  | { k: 'attackCostSet'; attack: string; cost: PType[] }
  /** Attacks of the affected Pokémon cost this many Energy fewer, of any type: the player leaves out that many requirements. */
  | { k: 'attackCostLess'; n: number; attack?: string }
  /** The affected Pokémon has no Weakness. */
  | { k: 'noWeakness' }
  /**
   * From a Tool: the Pokémon it is attached to can use the attack(s) printed on the Tool (Technical Machine, Core Memory). The
   * Energy cost is the attack's own (and any cost effects apply); the program runs as if printed on the Pokémon. Use `filter` for
   * "The Mega Zygarde ex this card is attached to can use...". Switched off with the Tool by Jamming Tower.
   */
  | { k: 'grantsAttacks' }
  /**
   * The affected Pokémon may attack twice each turn (Festival Lead): after its attack it may attack once more, with a printed
   * attack, including after the first one Knocked Out the Active Pokémon and the opponent has chosen a new one. Put the condition
   * in the static's `when` ("If Festival Grounds is in play").
   */
  | { k: 'attackTwice' }
  /** The affected Pokémon's Weakness becomes this type (×2). */
  | { k: 'weaknessType'; type: PType }
  /** Damage the affected Pokémon's attacks do to the opponent's Active Pokémon (before W/R). */
  | {
      k: 'damageOut';
      amount: number;
      vs?: Filter;
      /** lane:trevenant — "The effect of <name> doesn't stack": damageOut statics sharing this key count once per attack. */
      noStack?: string;
    }
  /** Damage the affected Pokémon takes from attacks (after W/R; negative = reduction). `fromOpp`: only from the opponent's attacks. */
  | {
      k: 'damageIn';
      amount: number;
      fromOpp?: boolean /* lane:metal */;
      attacker?: Filter;
      /** "The effect of <name> doesn't stack": damageIn statics sharing this key count once per attack (as `damageOut`'s). */
      noStack?: string;
    }
  /**
   * "If the affected Pokémon tries to use an attack, its owner's opponent flips a coin. If tails, that attack doesn't happen."
   * The flip comes before Confusion's (TPCi 2026-04-02 ruling 2326, 2026-03-26 ruling 2317).
   */
  | {
      k: 'attackCoinFlip';
      /** "flips 2 coins. If either of them is tails, that attack doesn't happen": how many coins are flipped (default 1); all are flipped. */
      coins?: number;
    }
  /**
   * The affected Pokémon can't be affected by these Special Conditions (default: any of them). They are not applied, and any it
   * has are removed as soon as the immunity applies (the Energy was attached, the Ability is on again). Checked when Knock Outs
   * are, i.e. after every action, and at Checkup.
   */
  | { k: 'conditionImmunity'; conditions?: SpecialCondition[] }
  /**
   * A timed effect that reacts to an event on the affected Pokémon (an attack's lasting effect, not an Ability: "no Abilities"
   * doesn't stop it, and Mist Energy-style prevention of effects of attacks applies to what the program does to the Attacking
   * Pokémon). Only meaningful on the `effect` step, with `on`. The program runs once the current action has resolved, before Knock
   * Outs are checked.
   *  - 'damagedByAttack': the Pokémon took damage from an opponent's attack, wherever it is (even if that Knocks it Out). In the
   *    program `{ v: '__attacker' }` is the Attacking Pokémon. Reacts once per effect per attack.
   *  - 'attachFromHand': its owner attached an Energy card from their hand to it, by their turn action or by an effect.
   *    `{ v: '__target' }` (and 'defender') is the Pokémon the Energy went to.
   * The effect's controller (the player whose attack made it) runs the program.
   */
  | { k: 'react'; event: ReactEvent; program: Program }
  /** Energy can't be attached from hand to the affected Pokémon (by the owner's turn action or by an effect). */
  | { k: 'cantAttachFromHand' }
  | { k: 'hp'; delta: number }
  | { k: 'cantAttack' }
  | { k: 'cantRetreat' }
  /** The affected Pokémon have no Abilities (other than this source's own). */
  | { k: 'noAbilities' }
  /** The affected player can't play Item cards. */
  | { k: 'itemLock' }
  /**
   * The affected player can't play these cards from their hand: Stadium cards, Supporter cards, ACE SPEC cards (any Trainer or
   * Energy with the ACE SPEC rule), or Pokémon to evolve their Pokémon ('evolve': evolving from the hand by their turn action or by
   * Rare Candy). Player-level, like `itemLock`: scope 'me' / 'opp' / 'both', or as a timed effect on a player.
   */
  | { k: 'playLock'; what: PlayLock }
  /**
   * Prevent all effects of Item and/or Supporter cards the OPPONENT plays from their hand that are done to the affected Pokémon
   * ("Whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to this Pokémon").
   */
  | { k: 'preventTrainerEffects'; from: ('item' | 'supporter')[] }
  /**
   * Each player who has any Pokémon matching `withPokemon` in play (any player, without it) can have up to `size` Pokémon on their
   * Bench instead of 5 (Area Zero Underdepths: "Each player who has any Tera Pokémon in play can have up to 8 Pokémon on their
   * Bench"). Player-level (scope 'both' from a Stadium). The largest size that applies wins. When it stops applying, a player with
   * too many Benched Pokémon discards down to the limit (see flow.ts `enforceBenchLimit`).
   */
  | { k: 'benchSize'; size: number; withPokemon?: Filter }
  /** Damage counters on Pokémon can't be moved (Watchful Eye). */
  | { k: 'countersFixed' }
  // lane:misc — Togekiss, Wonder Kiss: "When your opponent's Active Pokémon is Knocked Out, (flip a coin. If heads,)
  // take 1 more Prize card." Player-level (scope 'me'); never stacks.
  // Generalised: `amount` (default 1) more Prize cards; with `attacker`, only when the Knock Out is by damage from an attack of an
  // attacking Pokémon matching it ("an attack used by your N's Pokémon"); `noStack`: effects sharing the key count once (a
  // legacy effect with no `amount` and no key never stacks).
  | { k: 'extraPrize'; flip?: boolean; amount?: number; attacker?: Filter; noStack?: string }
  /**
   * "If the affected Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon (matching `attacker`), that
   * player takes `delta` fewer/more Prize cards" (negative = fewer), or with `none`, "your opponent can't take any Prize cards
   * for it". Checked before the Knock Out, so the source may be Knocked Out in the same moment (TPCi Rules Team 2025-11-13,
   * ruling 2262). `noStack`: effects sharing the key count once. Never takes the total below 0.
   */
  | { k: 'koPrizes'; delta?: number; none?: boolean; attacker?: Filter; noStack?: string }
  /**
   * "If the affected Pokémon would be Knocked Out by damage from an attack, flip a coin. If heads, it is not Knocked Out, and
   * its remaining HP becomes 10." The full damage is dealt first; the flip is made when Knock Outs are checked, after the
   * attack (TPCi Rules Team 2026-01-22, ruling 2287). The owner flips.
   */
  | { k: 'surviveKoCoinFlip' }
  /**
   * The affected Pokémon is (only) these types, or with `add`, also these types ("it is {F} and {P} type"). Weakness and
   * Resistance (as the attacker) and type filters see them. Only `scope: 'self'` with no `when`/`filter`, on the Pokémon's own
   * Ability or card text, is supported; it is not switched off by "no Abilities" effects (the type filters such an effect uses
   * would otherwise depend on it).
   */
  | { k: 'types'; types: PType[]; add?: boolean }
  // lane:misc — Psyduck, Damp: the affected Pokémon lose any Ability that Knocks Out the Pokémon using it
  // (AbilityScript.selfKo, else detected from the printed text "this Pokémon is Knocked Out").
  | { k: 'loseSelfKoAbilities' }
  /** The affected Pokémon can't use this one attack ("this Pokémon can't use Mega Brave"). */ // lane:fighting
  | { k: 'cantUseAttack'; attack: string } // lane:fighting
  /** From a Stadium: Pokémon Tools attached to every Pokémon have no effect (Jamming Tower). */ // lane:fighting
  | { k: 'noToolEffects' } // lane:fighting
  /** Prevent damage counters (not damage) placed on the affected Pokémon by effects of the opponent's attacks/Abilities (Battle Cage). */ // lane:darkrai
  | { k: 'preventCounters'; from: ('attack' | 'ability')[] } // lane:darkrai
  /**
   * lane:zoroark — Survival Brace: if the affected Pokémon has full HP (no damage) and damage from an
   * opponent's attack would Knock it Out, it is left with 10 HP instead; a Tool source is then discarded.
   */
  | { k: 'surviveKoAtFullHp' }; // lane:zoroark

/** Parts of the damage pipeline an attack's damage skips ("isn't affected by Weakness or Resistance"). */ // lane:fighting
export interface DamageIgnore {
  weakness?: boolean;
  resistance?: boolean;
  /**
   * "isn't affected by any effects on your opponent's Active Pokémon" (or "... on those Pokémon", for attacks that hit several): no
   * damageIn, no prevention, printed Weakness. Applies to every opposing target the damage goes to, Benched ones included.
   */
  defenderEffects?: boolean;
}

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

/** What a `playLock` stops a player playing from their hand. */
export type PlayLock = 'stadium' | 'supporter' | 'aceSpec' | 'evolve';

export type Duration = 'thisTurn' | 'oppNextTurn' | 'myNextTurn';

/** What a `react` timed effect waits for. */
export type ReactEvent = 'damagedByAttack' | 'attachFromHand';

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
  /**
   * Discard Energy from a Pokémon: all of it, or `count` chosen by the controller. `count` is Energy
   * CARDS ("discard an Energy" is one card, however much it provides) unless `units` is set: then
   * the cards discarded must provide at least `count` Energy, with no card to spare (paying a
   * Retreat Cost: a card providing {C}{C}{C} pays 3 points).
   */
  | { op: 'discardEnergy'; from: SlotRef; count: Expr | 'all'; filter?: Filter; as?: string; units?: boolean }
  /** Attack damage, through Weakness, Resistance and every modifier. */
  | { op: 'damage'; amount: Expr; to?: SlotRef | { each: SlotZone; filter?: Filter } | { v: string }; ignore?: DamageIgnore /* lane:fighting */ }
  /** Place damage counters: no Weakness, Resistance or damage modifiers. */
  | { op: 'counters'; n: Expr; to: SlotRef | { each: SlotZone; filter?: Filter } }
  | { op: 'heal'; amount: Expr; to: SlotRef | { each: SlotZone; filter?: Filter } }
  | {
      op: 'condition';
      cond: SpecialCondition;
      to: SlotRef;
      /**
       * Poisoned: "During Pokémon Checkup, place N damage counters on that Pokémon instead of 1" (every Checkup while it stays
       * Poisoned: TPCi 2026-06-04, ruling 2373). Confused: "Put N damage counters instead of 3 on that Pokémon for this Special
       * Condition" (when the flip fails). A later application of the condition replaces the amount (plain Poison: ruling 1044).
       */
      counters?: number;
    }
  /** Switch the Active Pokémon of `who` with one of their Benched Pokémon. */
  | { op: 'switch'; who: Who; chooser?: Who; with?: SlotRef }
  /** Flip coins; heads count lands in `as`. 'untilTails' flips until a tails. */
  | { op: 'flip'; n: Expr | 'untilTails'; as: string }
  | { op: 'set'; v: string; value: Expr }
  | { op: 'if'; cond: Cond; then: Step[]; else?: Step[] }
  | { op: 'repeat'; n: Expr; body: Step[] }
  /** "You may ..." -- a yes/no decision for the controller. */
  | { op: 'may'; body: Step[]; prompt?: string }
  /**
   * "At the end of <the turn named by `duration`>, <program>": schedule a program to run at that turn's end, before Pokémon
   * Checkup. The Pokémon in `on` (default the Defending Pokémon) is tracked: if it leaves the Active Spot, evolves or is
   * Knocked Out first, the program is dropped (TPCi 2026-07-16, ruling 2404). In the program, 'defender' is that Pokémon.
   * From an attack, it is not scheduled on a Pokémon protected from the effects of attacks.
   */
  | { op: 'delay'; duration: Duration; program: Step[]; on?: SlotRef }
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
  | { op: 'end' }
  /**
   * Look at (or with `reveal`, reveal) the top `n` cards of a deck, without moving them. The cards among them that match
   * `filter` (all of them without one) are kept in `as`, for a later `move` / `putOnTop` / count ("70 damage for each Future card
   * you find there", "put them back in any order").
   */
  | { op: 'look'; n: Expr; who?: Who; filter?: Filter; as: string; reveal?: boolean }
  /** "Your turn ends": as after an attack, once the effect has resolved (no attack is used, so nothing counts as damaged by one). */
  | { op: 'endTurn' };

export type Program = Step[];

/** How a card definition's damage number is computed (default: the printed number). */
export interface AttackScript {
  /** "You can use this attack only if ...": the attack is not offered unless this holds (evaluated for the attacking Pokémon). */
  usable?: Cond;
  /** "If you go first, you can use this attack during your first turn": the attack is also usable on turn 1 (the first player's first turn). */
  firstTurn?: boolean;
  /** Steps before damage (costs paid by the attack, coin flips that set damage). */
  pre?: Program;
  /** Base damage expression; defaults to the printed number (e.g. "30+" → 30). */
  damage?: Expr;
  /** Where the attack's damage goes. Defaults to the Defending Pokémon. */
  target?: SlotRef | { each: SlotZone; filter?: Filter } | { v: string };
  /** Pipeline parts the printed damage skips. */ // lane:fighting
  ignore?: DamageIgnore; // lane:fighting
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
  | 'pokemonBenched'
  /**
   * lane:ghost — the OPPONENT attached an Energy card from their hand to one of their Pokémon
   * (Gengar ex, Gnawing Curse). The program sees that Pokémon's slot id in `__target`.
   */
  | 'oppAttachFromHand'
  /**
   * This Pokémon moved from the Active Spot to its owner's Bench (switch or retreat; not a Knock Out, not a shuffle into the
   * deck). Fires when the move is done, with the Pokémon on the Bench; `turnOf` in `when` limits it to a turn.
   */
  | 'movedToBench'
  /**
   * The OPPONENT's Active Pokémon moved to their Bench during their own turn (switch or retreat; a Knock Out and its
   * replacement is not one). Fires for every Pokémon of the other side with the trigger; the program sees the Pokémon that
   * moved in `__target` and its replacement is the opponent's Active Pokémon. `when` is checked as the move happens, so a
   * Pokémon that becomes Active in the same switch has not been Active when it moved (TPCi Rules Team 2026-04-16, ruling 2339).
   */
  | 'oppActiveMovedToBench'
  /**
   * This Pokémon was damaged by an attack from the opponent's Pokémon, wherever it is (Active or Benched), even if it is Knocked
   * Out by it. The program runs once the attack has resolved; `{ v: '__attacker' }` is the Attacking Pokémon (Orthworm ex,
   * Pummeling Payback). Not for damage that was prevented or reduced to 0 (that is `damageReduced`).
   */
  | 'damagedByAttack'
  /**
   * For a Tool: an effect of THIS card reduced damage from an attack done to the Pokémon it is attached to, Active or Benched, even
   * to 0 (the Berries: "it takes 60 less damage..., and discard this card"). Fires for the card whose static (a `damageIn` with a
   * negative amount) took effect, once per damage instance, when the attack has resolved.
   */
  | 'damageReduced';

export interface TriggerScript {
  on: TriggerOn;
  /**
   * "Once during your turn, when ... you may use this Ability": a Pokémon's trigger that fires only during its controller's turn
   * and can be used once per turn. A use counts when it is accepted, not when it is declined. A Pokémon's own triggers only.
   */
  oncePerTurn?: boolean;
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
  /**
   * Trainer (Tool/Stadium) and Energy passives. On a Pokémon card these are printed on the card itself, not in an Ability
   * (e.g. an attack that "can be used for {D}" when a condition holds): they apply while it is in play and are not switched
   * off by "no Abilities" effects.
   */
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
  /** Energy: "provides every type of Energy but provides only n Energy at a time" (while the holder matches `when`). */ // lane:fighting
  providesAny?: { n: number; when?: Filter }; // lane:fighting
  /** Energy: when the holder is Knocked Out by damage from an opponent's attack, that player takes `delta` more Prizes (negative = fewer). */ // lane:fighting
  koPrizeDelta?: { delta: number; oncePerGame?: boolean }; // lane:fighting
  /** Data corrections where the catalog is wrong (e.g. TCGdex marks some Special Energy "Normal"). */
  fix?: {
    specialEnergy?: boolean;
    aceSpec?: boolean;
    tera?: boolean;
    /** lane:misc — the catalog lists no "evolves from" for this Stage 1/2 card (TCGdex 30th-123 Hisuian Zoroark). */
    evolvesFrom?: string;
    /**
     * The catalog omits the printed Weakness / Resistance (TCGdex sv10.5b-067 Genesect ex has neither;
     * the card prints Fire ×2 and Grass -30, per pokemon-tcg-data zsv10pt5-67). See DATA-DIFF.md.
     */
    weakness?: PType;
    resistance?: { type: PType; amount: number };
    /**
     * lane:ghost — a Trainer played onto the Bench "as if it were a <hp>-HP Basic <type> Pokémon"
     * (Antique fossils). It is still an Item in every other zone (searched, Item-locked, never placed
     * during setup); in play it is a Basic Pokémon worth 1 Prize card.
     */
    playAsBasic?: {
      hp: number;
      type: PType;
      /** "This card can't retreat." */
      cantRetreat?: boolean;
      /** "This card can't be affected by any Special Conditions." */
      noConditions?: boolean;
      /** "At any time during your turn, you may discard this card from play." */
      discardable?: boolean;
    };
  };
  /** Free-text notes: rulings consulted, open questions. */
  notes?: string;
  /** Ruling status of the definition. */
  status?: 'implemented' | 'needs_ruling';
}
