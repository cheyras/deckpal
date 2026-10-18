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
  /** In-play only: at least one attached Pokémon Tool card matches ("has a Future Booster Energy Capsule attached"). */
  toolCard?: Filter;
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
  /** That player's Prize cards that are face up / face down (matching `filter`; a face-up card is known to both players). */
  | { prizeCards: { who?: Who; face: 'up' | 'down'; filter?: Filter } }
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
   * Any of that player's Pokémon (matching `filter`; `other`: not the Pokémon this is asked of) used an attack during that player's
   * last turn (default: the effect's controller). A Confused Pokémon whose flip failed, or one stopped by a coin flip, did not use
   * one (TPCi Rules Team 2024-11-14, ruling 2087). The record belongs to the Pokémon in play, not to the card: a card swapped into its
   * place by Thorton is the same Pokémon (ruling 2092).
   */
  | { attackedLastTurn: { who?: Who; filter?: Filter; other?: boolean } }
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
      /**
       * Only damage from attacks of an attacking Pokémon matching this ("attacks from Basic Pokémon"). With `andEffects` it limits
       * the effects too: "Prevent all damage from and effects of attacks from your opponent's Tera Pokémon" prevents nothing done by
       * an attack of a Pokémon that is not a Tera Pokémon.
       */
      attacker?: Filter;
      /**
       * "Prevent all damage ... if that damage is N or less" (Metapod, Roggenrola's Harden): only damage of at most this much, as it
       * stands after Weakness, Resistance and the effects that change damage taken (TPCi Rules Team 2025-07-17, ruling 2197). Not
       * effects, and not damage of 0.
       */
      ifAtMost?: number;
      /** "... if that damage is N or more" (Drednaw, Impervious Shell): only damage of at least this much, measured the same way. */
      ifAtLeast?: number;
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
  /** Add to the affected Pokémon's max HP. `noStack`: "The effect of <name> doesn't stack": hp statics sharing the key count once. */
  | { k: 'hp'; delta: number; noStack?: string }
  /**
   * "During Pokémon Checkup, put N more damage counters on <the affected Pokémon that is Poisoned / Burned>" (Magma Surge,
   * Perilous Jungle). The counters are part of that Special Condition's own, placed before a Burn flip, so a Pokémon that recovers
   * from Burn at that flip still takes them (TPCi Rules Team 2025-03-27, ruling 2112: 2+3+3 with a second source). Several sources add up
   * unless they share a `noStack` key.
   */
  | { k: 'checkupCounters'; cond: 'poisoned' | 'burned'; n: number; noStack?: string }
  /**
   * The affected Pokémon can't attack. `ifEnergyAtMost`: only while it has that many Energy attached or fewer, counted in the units
   * they provide (Walrein, Frigid Fangs: "Pokémon that have 2 or less Energy attached can't attack").
   */
  | { k: 'cantAttack'; ifEnergyAtMost?: number }
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
  | {
      k: 'playLock';
      what: PlayLock;
      /** 'abilityPokemon' only: "except for Team Rocket's Pokémon": cards matching this are not locked (matched on the card in hand). */
      except?: Filter;
    }
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
  /**
   * Evolving earlier than the rules allow, for the affected Pokémon. `firstTurn`: it can evolve during its owner's first turn.
   * `justPlayed`: it can evolve the turn it was played (put into play, or evolved: a Pokémon that evolved this turn can evolve again,
   * TPCi Rules Team 2025-09-25, ruling 2229, Forest of Vitality). `into`: only into an Evolution card matching this ("{G} Pokémon can
   * evolve into {G} Pokémon"). Put the condition in the static's `when`. A player stopped from evolving (`playLock` 'evolve') stays
   * stopped.
   */
  | { k: 'evolveTiming'; firstTurn?: boolean; justPlayed?: boolean; into?: Filter }
  /**
   * The affected Pokémon can evolve into any Evolution card matching `filter` that evolves from `evolvesFrom`, as well as the
   * cards it evolves into normally ("Eevee ex can evolve into any Pokémon ex that evolves from Eevee if you play it from your hand
   * onto this Pokémon"). The usual timing rules still apply.
   */
  | { k: 'evolveInto'; evolvesFrom: string; filter?: Filter }
  /**
   * "If the affected Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, put <it / the Basic Energy
   * attached to it> into your hand instead of the discard pile." `cards: 'pokemon'`: the Pokémon with every card it evolved from
   * (the attached cards are discarded: TPCi Rules Team 2026-03-26, ruling 2308); `cards: 'energy'`: the attached Energy cards matching
   * `filter`. The Pokémon is still Knocked Out: its Prize cards are taken (ruling 2307). `optional`: its controller decides ("you may").
   * With scope 'self' it is the Pokémon's own Ability; with 'myPokemon' it covers other Pokémon of yours (Huntail's {W} Pokémon).
   */
  | { k: 'koToHand'; cards: 'pokemon' | 'energy'; filter?: Filter; optional?: boolean }
  /** Damage counters on Pokémon can't be moved (Watchful Eye). */
  | { k: 'countersFixed' }
  // lane:misc — Togekiss, Wonder Kiss: "When your opponent's Active Pokémon is Knocked Out, (flip a coin. If heads,)
  // take 1 more Prize card." Player-level (scope 'me'); never stacks.
  // Generalised: `amount` (default 1) more Prize cards; with `attacker`, only when the Knock Out is by damage from an attack of an
  // attacking Pokémon matching it ("an attack used by your N's Pokémon"); `noStack`: effects sharing the key count once (a
  // legacy effect with no `amount` and no key never stacks).
  // `ko`: the Knocked Out Pokémon must match this, wherever it was (Active or Benched), and it must have been Knocked Out by damage
  // from an attack; each such Pokémon gives the extra Prize cards ("If your opponent's Basic Pokémon is Knocked Out by damage from
  // an attack used by this Pokémon, take 1 more Prize card"). `byThis`: the attack must be one used by the Pokémon this effect comes
  // from (an Ability of the Pokémon), not just any matching Pokémon of yours.
  // `thisAttack`: only the attack that set this (timed) effect, whoever uses it - the Pokémon and the attack of that turn, not a
  // printed card name (a Pokémon borrowing the attack counts: Mew ex using Unown's Mysterious Signal).
  | { k: 'extraPrize'; flip?: boolean; amount?: number; attacker?: Filter; noStack?: string; ko?: Filter; byThis?: boolean; thisAttack?: boolean }
  /**
   * "If the affected Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon (matching `attacker`), that
   * player takes `delta` fewer/more Prize cards" (negative = fewer), or with `none`, "your opponent can't take any Prize cards
   * for it". Checked before the Knock Out, so the source may be Knocked Out in the same moment (TPCi Rules Team 2025-11-13,
   * ruling 2262). `noStack`: effects sharing the key count once. Never takes the total below 0.
   */
  // `anyKo`: any Knock Out of the Pokémon counts (not only by damage from an attack). `duringTakersTurn`: only while it is the turn of
  // the player who takes the Prize cards -- a timed effect "During your next turn, if the Defending Pokémon is Knocked Out, take 2 more
  // Prize cards" (Plentiful Pollen) lasts through the opponent's turn in between, but does nothing then. As an attack's lasting effect
  // it ends when the Pokémon leaves the Active Spot or evolves (TPCi Rules Team 2024-03-21, ruling 1957).
  | { k: 'koPrizes'; delta?: number; none?: boolean; attacker?: Filter; noStack?: string; anyKo?: boolean; duringTakersTurn?: boolean }
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
  | { k: 'surviveKoAtFullHp' } // lane:zoroark
  /**
   * The affected Pokémon may have up to `n` Pokémon Tool cards attached (Rotom ex, Multi Adapter), where the rules allow 1. The most
   * any effect on it allows counts. When the effect stops applying, its owner discards Tools from the Pokémon until only as many
   * remain as it now allows (checked after every action, with Knock Outs).
   */
  | { k: 'toolSlots'; n: number }
  /**
   * "If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage." (Cinccino ex, Kecleon, Fezandipiti:
   * put the condition in the static's `when`.) The affected Pokémon's owner flips, once for each such effect, only when the attack
   * would really do damage to it (not for 0, not for damage that something else already prevented). It is an effect on the Defending
   * Pokémon, so an attack that "isn't affected by any effects on your opponent's Active Pokémon" skips the flip and does its damage
   * (TPCi Rules Team 2024-11-07, ruling 2040). A Bench or Active Pokémon alike.
   */
  | { k: 'damageCoinFlip' }
  /**
   * Player-level (scope 'opp' from the Pokémon with the Ability): "When your opponent's Active Pokémon retreats, your opponent flips a
   * coin. If tails, Energy for its Retreat Cost is not discarded, and they don't switch Pokémon." The retreat still counts as their
   * retreat for the turn (TPCi Rules Team 2026-05-21, ruling 2348). Several of these never stack: one flip.
   */
  | { k: 'retreatCoinFlip' }
  /**
   * From a Tool (scope 'self', with a `filter` for the Pokémon it works on): "Once during your turn, after you flip any coins for an
   * attack of this Pokémon, you may ignore all results of those coin flips and begin flipping those coins again." Offered after the
   * attack's coin flips (not Confusion's: TPCi Rules Team 2026-07-16, ruling 2417); all of the attack's flips are flipped again, never
   * only the tails (ruling 2416). Offered for an attack whose program has one flip step it runs once.
   */
  | { k: 'coinReflip' }
  /** Confused Pokémon don't recover from Confusion when they evolve or devolve (Dizzying Valley). */
  | { k: 'keepConfusion' }
  /**
   * Energy cards matching `cards` attached to the affected Pokémon provide `provides` instead of what they print ("Each Basic {G}
   * Energy attached to all of your Pokémon provides {G}{G} Energy"). A replacement, not an addition: two of them don't add up, the
   * first that applies is used (TPCi Rules Team 2025-10-23, ruling 2236). It changes every count of attached Energy (ruling 2237).
   */
  | { k: 'energyProvides'; cards: Filter; provides: PType[] }
  /** Player-level: that player's Pokémon in play and all cards attached to them can't be put into their hand (Milotic, Mentally Calm). */
  | { k: 'noReturnToHand' }
  /** The affected evolved Pokémon can use any attack of the cards beneath its top card, with the Energy it needs (Relicanth, Memory Dive). */
  | { k: 'previousAttacks' }
  /**
   * Weakness is applied as ×`mult` instead of ×2 for the affected Pokémon (Illumise, Supereffective Pheromones: "apply Weakness for both
   * Active Pokémon as ×3": scope 'allPokemon', since Weakness only ever applies to an Active Pokémon). Where several apply, the highest wins.
   */
  | { k: 'weaknessMultiplier'; mult: number }
  /**
   * Player-level (timed, from Seismitoad's Quaking Fist): "whenever they try to use a Trainer card from their hand, they flip a coin. If
   * tails, ... discards that Trainer card instead of using it." Checked when the card is played (an Item, Supporter, Stadium or Pokémon
   * Tool): on tails it goes to the discard pile, none of its effects happen, and it does not count as played this turn.
   */
  | { k: 'trainerCoinFlip' }
  /** The affected Pokémon can't be healed: no heal effect, from anyone, removes damage counters from it (Yveltal, Life-Locked). */
  | { k: 'noHeal' }
  /**
   * The affected Pokémon can use the attacks of any of its owner's Benched Pokémon (Mew ex, Memory Helix). The Energy cost is the
   * attack's own, and the attack is used as an attack of this Pokémon: its effects happen to and from it, and "can't use this attack"
   * restrictions it sets are kept by name on this Pokémon.
   */
  | { k: 'borrowAttacks' };

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
export type PlayLock =
  | 'stadium'
  | 'supporter'
  | 'aceSpec'
  | 'evolve'
  /** Pokémon Tool cards (attaching a Tool from the hand). */
  | 'tool'
  /**
   * Pokémon that have an Ability (printed on the card in hand: an effect that takes away Abilities in play doesn't change that,
   * TPCi Rules Team 2025-05-29, ruling 2147), put onto the Bench or played to evolve, from the hand. `except` on the static spares some.
   */
  | 'abilityPokemon';

/**
 * When a timed effect applies, for the player whose card made it ("your"): `thisTurn` is the rest of this turn; `oppNextTurn` and
 * `myNextTurn` are that whole next turn only ("During your opponent's next turn" does not cover the rest of this one); and
 * `throughMyNextTurn` is from now until the end of your next turn ("until the end of your next turn").
 */
export type Duration = 'thisTurn' | 'oppNextTurn' | 'myNextTurn' | 'throughMyNextTurn';

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
      /** `to: 'bench'` only: Pokémon of any Stage may be put onto the Bench (Klinklang: "put this Pokémon onto your Bench"), not only Basic ones. */
      anyStage?: boolean;
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
   * Retreat Cost: a card providing {C}{C}{C} pays 3 points). `upToCards` (with `units`; a Retreat Cost) allows any set that provides
   * at least `count` and has no more cards than `count`: a Retreat Cost of 2 can be paid with one {C}{C} card or with two (TPCi Rules
   * Team 2025-03-27, Compendium #2127).
   */
  | { op: 'discardEnergy'; from: SlotRef; count: Expr | 'all'; filter?: Filter; as?: string; units?: boolean; upToCards?: boolean }
  /** Attack damage, through Weakness, Resistance and every modifier. */
  | { op: 'damage'; amount: Expr; to?: SlotRef | { each: SlotZone; filter?: Filter } | { v: string }; ignore?: DamageIgnore /* lane:fighting */ }
  /** Place damage counters: no Weakness, Resistance or damage modifiers. */
  | { op: 'counters'; n: Expr; to: SlotRef | { each: SlotZone; filter?: Filter } }
  /** Heal damage. `as` keeps the damage actually removed (0 when the Pokémon had none or can't be healed), for "if you healed any damage in this way". */
  | { op: 'heal'; amount: Expr; to: SlotRef | { each: SlotZone; filter?: Filter }; as?: string }
  | {
      op: 'condition';
      cond: SpecialCondition;
      to: SlotRef;
      /**
       * Poisoned: "During Pokémon Checkup, place N damage counters on that Pokémon instead of 1" (every Checkup while it stays
       * Poisoned: TPCi 2026-06-04, ruling 2373). Burned: the same, instead of 2 (placed before the Burn flip). Confused: "Put N damage
       * counters instead of 3 on that Pokémon for this Special Condition" (when the flip fails). A later application of the
       * condition replaces the amount (plain Poison: ruling 1044).
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
   * `global`: an effect that is not tied to a Pokémon (Amarys: "At the end of this turn, if you have 5 or more cards in your hand,
   * discard your hand"): nothing is tracked, it always runs. When it and another effect both wait for the end of the turn, the
   * turn's player chooses which goes first (TPCi Rules Team 2025-05-01, ruling 2135).
   */
  | { op: 'delay'; duration: Duration; program: Step[]; on?: SlotRef; global?: boolean }
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
  /**
   * Turn 1 of a player's face-down Prize cards face up ("That Prize card remains face up for the rest of the game"). Nothing happens
   * with no face-down Prize card. The Prize card is the controller's pick among cards they can't see, so the engine takes the first
   * face-down one. The card lands in `as`.
   */
  | { op: 'turnPrizeUp'; who?: Who; as?: string }
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
   * This Pokémon moved from its owner's Bench to the Active Spot (switch, retreat or promotion; the mirror of `movedToBench`). Fires
   * when the move is done, with the Pokémon Active; use `oncePerTurn` for "Once during your turn, when this Pokémon moves from your
   * Bench to the Active Spot, you may use this Ability" (which also limits it to the owner's own turn).
   */
  | 'movedToActive'
  /**
   * One of the controller's Pokémon moved from the Bench to the Active Spot (as `movedToActive`), for every Pokémon of that side
   * with the trigger: the program sees the Pokémon that moved in `__target`, and `when` can ask about it
   * (`slotIs: { ref: { v: '__target' }, filter }` for "when your Mega Latias ex moves from your Bench to the Active Spot").
   */
  | 'allyMovedToActive'
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
  | 'damageReduced'
  /**
   * The controller attached an Energy card from their hand to one of their Pokémon (by their turn action or by an effect), for every
   * Pokémon of theirs with the trigger: the program sees the Pokémon that Energy went to in `__target` (Magearna, Auto Heal).
   */
  | 'allyAttachFromHand'
  /**
   * The OPPONENT played a Pokémon from their hand to evolve one of their Pokémon (by their turn action or Rare Candy). Fires for every
   * Pokémon of the other side with the trigger; `__target` is the Pokémon that evolved (Team Rocket's Ampharos, Darkest Impulse).
   */
  | 'oppEvolveFromHand'
  /**
   * This card, in its owner's DECK, was discarded from there by an effect of the opponent's attack or Ability or of an Item or
   * Supporter card, during the opponent's turn (Ferrothorn, Startling Drop). The card is not in play: the program runs with no
   * Pokémon slot, for the card's owner.
   */
  | 'discardedFromDeck'
  /**
   * The controller's Active Pokémon was damaged by an attack from the opponent's Pokémon (even if it is Knocked Out by it), for every
   * Pokémon of theirs with the trigger, Active or Benched (Spiritomb, Spiteful Swirl). The program runs once the attack has resolved:
   * `__target` is the Pokémon that was damaged and `__attacker` the Attacking Pokémon; once per Pokémon with the trigger per attack.
   */
  | 'allyActiveDamagedByAttack';

export interface TriggerScript {
  /**
   * 'damagedByAttack' / 'damagedByAttackActive' only: the attack must have done at least this much damage to the Pokémon, as it was
   * done (after Weakness, Resistance and every effect), in one instance of damage (Tremendous Bomb: "takes 240 or more damage").
   */
  minDamage?: number;
  /** 'damagedByAttack' / 'damagedByAttackActive' only: the attack must be by a Pokémon that matches this ("from your opponent's Mega Evolution Pokémon ex"). */
  attacker?: Filter;
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
  /** "The effect of <name> doesn't stack": for one event only one Pokémon's copy of this trigger fires (`oppEvolveFromHand`). */
  noStack?: boolean;
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
    /**
     * Used from the HAND (Klinklang, Emergency Rotation: "if this Pokémon is in your hand ..."), not from play. The program runs with no
     * Pokémon in play: the card is the variable `__this` (a `move` of it with `anyStage` puts it onto the Bench). `when` is checked with
     * no source Pokémon. Offered once per turn per card.
     */
    fromHand?: boolean;
  };
  /** "If this Pokémon is in your hand when you are setting up to play, you may put it face down in the Active Spot." (Cinderace, Explosiveness). */
  setupActive?: boolean;
  /**
   * "Put this Pokémon into play only with the effect of <by>" (Palafin ex, Hero's Spirit): the card can't be benched or played to evolve
   * from the hand, nor with Rare Candy; only an effect that names it puts it into play.
   */
  putIntoPlayOnlyBy?: string;
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
  /**
   * Energy: when discarded by an effect of an attack used by the attached Pokémon (if it matches `holder`), put it into its owner's hand after
   * the attack's damage and effects (Nitro Fire Energy: "used by the {R} Pokémon this card is attached to").
   */
  handAfterOwnAttack?: { holder: Filter };
  /** Energy: "This card can only be attached to a <filter>. If it is attached to anything else, discard it." Checked on every way of attaching and after every action. */
  attachOnly?: Filter;
  /** Energy: provides `n` Energy, each of which is any one of `types` ("2 in any combination of {P} Energy and {D} Energy"). */
  providesFlex?: { n: number; types: PType[] };
  /** Trainer (Stadium): may be played even though a Stadium was already played this turn (Ange Floette: with `playable` naming the Stadium it replaces). */
  extraStadium?: boolean;
  /** "This card can't be put into your hand or deck from the discard pile." (Neutralization Zone, Poké Vital A): effects can't move it from the discard pile there. */
  noRecoverFromDiscard?: boolean;
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
