/**
 * Cards that were blocked on engine features, scripted once the features existed (see src/__tests__/engine-features-2.test.ts).
 * Written from the printed text in frames-extra/standard.ts (Okidogi: replay.ts); quotes below are that text.
 * Tests: src/__tests__/cards-std-engine2.test.ts.
 *
 * Features used: the Knocked-Out-by-an-attack trigger (Flygon, Pecharunt), Active-to-Bench triggers (Mismagius ex, Dugtrio,
 * Clawitzer), cards played this turn (Heliolisk, Team Rocket's Factory, Kangaskhan ex), first-turn attacks (Tapu Koko, Delibird),
 * Prize modifiers (Mega Gengar ex, Shedinja, Anthea & Concordia), last-turn records (Okidogi, Mega Heracross ex, Archer),
 * damageIn noStack (Aurorus), the `anyAbility` filter (Sacred Charm), a coin-flip Knock Out survival (Mega Hawlucha ex) and
 * a Pokémon's types (Carbink).
 */
import type { CardScript, Cond, Filter, Program } from '../../dsl.js';
import './std-seed1-customs.js'; // std.discardStadium
import './metal-customs.js'; // metal.moveEnergy

/** "Discard the top 2 cards of your opponent's deck." */
const DISCARD_TOP_2_OF_OPP: Program = [{ op: 'move', cards: { top: 2, who: 'opp' }, to: 'discard', who: 'opp' }];

/** "Each player shuffles their hand into their deck." */
const BOTH_HANDS_INTO_DECKS: Program = [
  { op: 'move', cards: { all: 'hand' }, to: 'deck' },
  { op: 'shuffle' },
  { op: 'move', cards: { all: 'hand', who: 'opp' }, to: 'deck', who: 'opp' },
  { op: 'shuffle', who: 'opp' },
];

/** A Supporter card that has "Team Rocket" in its name. */
const TEAM_ROCKET_SUPPORTER: Filter = { ttype: 'supporter', nameIncludes: 'Team Rocket' };

const N_POKEMON: Filter = { nameIncludes: "N's" };
const N_SIX = ["N's Darmanitan", "N's Zoroark ex", "N's Vanilluxe", "N's Klinklang", "N's Reshiram", "N's Zekrom"];
const inPlay = (name: string): Cond => ({ gte: [{ pokemon: { zone: 'myPokemon', filter: { name } } }, 1] });

export const STD_ENGINE2: CardScript[] = [
  // ---------------------------------------------------------------- Knocked Out by damage from an attack
  {
    id: 'me02-053',
    name: 'Flygon',
    abilities: [
      {
        // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability.
        //  You may also use this Ability if this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from
        //  your opponent's Pokémon. Discard the top 2 cards of your opponent's deck."
        // Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2243/): Flygon may use it on evolving from hand and again when later Knocked Out in the Active Spot by opposing attack damage (an evolved Flygon that is later Knocked Out may use it again)
        name: 'Sandy Flapping',
        triggers: [
          { on: 'evolveFromHand', optional: true, program: DISCARD_TOP_2_OF_OPP },
          { on: 'knockedOutByAttack', when: { inActive: 'self' }, optional: true, program: DISCARD_TOP_2_OF_OPP },
        ],
      },
    ],
  },
  {
    id: 'me02.5-143',
    name: 'Pecharunt',
    abilities: [
      {
        // "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, search your deck for a card and put it into your hand. Then, shuffle your deck."
        name: 'Final Chain',
        triggers: [
          {
            on: 'knockedOutByAttack',
            program: [
              { op: 'chooseCards', from: 'deck', min: 0, max: 1, as: 'found' },
              { op: 'move', cards: 'found', to: 'hand' },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon's Mochi Rush attack does 50 more damage (before applying Weakness and Resistance)."
      // An attack effect on this Pokémon: it ends if the Pokémon leaves the Active Spot or evolves.
      'Mochi Rush': { post: [{ op: 'effect', static: { k: 'damageOut', amount: 50 }, on: 'self', duration: 'myNextTurn' }] },
    },
  },

  // ---------------------------------------------------------------- A Pokémon moves from the Active Spot to the Bench
  {
    id: 'me02-036',
    name: 'Mismagius ex',
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, whenever your opponent's Active Pokémon moves to the Bench during their turn, their new Active Pokémon is now Confused."
        // Ruling (TPCi Rules Team 2026-04-16, https://compendium.pokegym.net/ruling/2339/): with Mismagius ex already Active, a Giovanni switch leaves the opponent's new Active Confused; if Giovanni brings a Benched Mismagius ex up, Swirling Prose is not yet in effect for that switch.
        // Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2247/): no, the replacement after a Knock Out happens on the knocking player's turn (a Knock Out and the promotion after it is not a move to the Bench)
        name: 'Swirling Prose',
        triggers: [{ on: 'oppActiveMovedToBench', when: { inActive: 'self' }, program: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] }],
      },
    ],
    attacks: {
      // "You may draw cards until you have 6 cards in your hand."
      'Hexa-Magic': { post: [{ op: 'may', body: [{ op: 'draw', n: { max: [0, { sub: [6, { handSize: 'self' }] }] } }] }] },
    },
  },
  {
    id: 'me02.5-101',
    name: "Team Rocket's Dugtrio",
    abilities: [
      {
        // "Whenever your opponent's Active Pokémon moves to the Bench during their turn, place 2 damage counters on that Pokémon."
        // Ruling (Ascending Heroes FAQ, TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2285/): the Ability stacks, so two Dugtrio place 2 counters each, 4 in total (two Dugtrio)
        // Ruling (Ascending Heroes FAQ, TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2286/): under Battle Cage the Pokemon is already on the Bench when the Ability applies, so it takes no counters.
        name: 'Holes',
        triggers: [{ on: 'oppActiveMovedToBench', program: [{ op: 'counters', n: 2, to: { v: '__target' } }] }],
      },
    ],
  },
  {
    id: 'me01-038',
    name: 'Clawitzer',
    abilities: [
      {
        // "Once during your turn, when this Pokémon moves from the Active Spot to your Bench, you may use this Ability. Attach up to 2 Basic {W} Energy cards from your hand to this Pokémon."
        // Used once per turn (counted when accepted); only during your turn. With no Basic {W} Energy card in hand there is nothing to attach, so it is not offered.
        name: 'Fall Back to Reload',
        triggers: [
          {
            on: 'movedToBench',
            oncePerTurn: true,
            optional: true,
            when: { gte: [{ count: { zone: 'hand', filter: { energyType: 'Water' } } }, 1] },
            program: [
              { op: 'chooseCards', from: 'hand', filter: { energyType: 'Water' }, min: 1, max: 2, as: 'e', prompt: 'Attach up to 2 Basic {W} Energy cards' },
              { op: 'attach', cards: 'e', to: 'self' },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "Discard all Energy from this Pokémon."
      'Aqua Launcher': { post: [{ op: 'discardEnergy', from: 'self', count: 'all' }] },
    },
  },

  // ---------------------------------------------------------------- Cards played from the hand this turn
  {
    id: 'me02.5-064',
    name: 'Heliolisk',
    abilities: [
      {
        // "Once during your turn, if you played Canari from your hand this turn, you may use this Ability. Search your deck for up to 2 Basic {L} Energy cards and attach them to this Pokémon. Then, shuffle your deck."
        // Ruling (Ascending Heroes FAQ, TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2284/): multiple Heliolisks can each use Frilled Generator once per turn.
        name: 'Frilled Generator',
        activated: {
          when: { playedThisTurn: { filter: { name: 'Canari' } } },
          program: [
            { op: 'chooseCards', from: 'deck', filter: { energyType: 'Lightning' }, min: 0, max: 2, as: 'e', prompt: 'Attach up to 2 Basic {L} Energy cards' },
            { op: 'attach', cards: 'e', to: 'self' },
            { op: 'shuffle' },
          ],
        },
      },
    ],
    attacks: {
      // "Flip a coin for each Energy attached to this Pokémon. This attack does 70 damage for each heads."
      'Powerful Bolt': {
        pre: [{ op: 'flip', n: { energyOn: 'self' }, as: 'h' }],
        damage: { mul: [70, { v: 'h' }] },
      },
    },
  },
  {
    id: 'me02.5-203',
    name: "Team Rocket's Factory",
    // "Once during each player's turn, if they played a Supporter card that has "Team Rocket" in its name from their hand this turn, they may draw 2 cards."
    // Not offered with an empty deck (it would draw nothing).
    stadiumAbility: {
      when: { and: [{ playedThisTurn: { filter: TEAM_ROCKET_SUPPORTER } }, { gte: [{ deckSize: 'self' }, 1] }] },
      program: [{ op: 'draw', n: 2 }],
    },
  },
  {
    id: 'me02.5-162',
    name: "Team Rocket's Kangaskhan ex",
    attacks: {
      // "Flip 4 coins. This attack does 30 damage for each heads."
      'Comet Punch': { pre: [{ op: 'flip', n: 4, as: 'h' }], damage: { mul: [30, { v: 'h' }] } },
      // "If you played a Supporter card that has "Team Rocket" in its name from your hand during this turn, this attack does 100 more damage."
      'Wicked Impact': { damage: { add: [120, { cond: { playedThisTurn: { filter: TEAM_ROCKET_SUPPORTER } }, then: 100, else: 0 }] } },
    },
  },

  // ---------------------------------------------------------------- Attacks usable on the first player's first turn
  {
    id: 'me02.5-067',
    name: 'Tapu Koko',
    attacks: {
      // "If you go first, you can use this attack during your first turn. Discard your hand and draw 5 cards."
      'Fast Flight': { firstTurn: true, post: [{ op: 'move', cards: { all: 'hand' }, to: 'discard' }, { op: 'draw', n: 5 }] },
      // "Discard 2 Energy from this Pokémon."
      'Thunder Blast': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'me01-105',
    name: 'Delibird',
    attacks: {
      // "If you go first, you can use this attack during your first turn. Search your deck for a card and put it into your hand. Then, shuffle your deck."
      'Quick Gift': {
        firstTurn: true,
        post: [
          { op: 'chooseCards', from: 'deck', min: 0, max: 1, as: 'found' },
          { op: 'move', cards: 'found', to: 'hand' },
          { op: 'shuffle' },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Prize cards
  {
    id: 'me02-056',
    name: 'Mega Gengar ex',
    abilities: [
      {
        // "If 1 of your {D} Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon ex, that player takes 1 fewer Prize card. The effect of Shadowy Concealment doesn't stack."
        // Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2262/): Shadowy Concealment still reduces the Prize cards when Mega Gengar ex is itself the Pokémon Knocked Out, even though it is already in the discard pile when Prizes are taken.
        // Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2244/): when the Knocked Out {D} Pokémon has Legacy Energy and Shadowy Concealment applies, the opponent takes 1 Prize for a Mega Evolution ex, 0 for a regular Pokémon ex and 0 for a non-ex; Legacy Energy counts as used and cannot cut Prizes again later.
        // Ruling (Phantasmal Flames FAQ, TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2245/): a Pokemon KO'd with its Prize prevented was still Knocked Out, so Krookodile's Vengeful Fang gets its bonus.
        name: 'Shadowy Concealment',
        statics: [
          {
            effect: { k: 'koPrizes', delta: -1, attacker: { ex: true }, noStack: 'Shadowy Concealment' },
            scope: 'myPokemon',
            filter: { type: 'Darkness' },
          },
        ],
      },
    ],
    attacks: {
      // "Move an Energy from this Pokémon to 1 of your Benched Pokémon."
      // The attacker is the Active Pokémon, so "another of your Pokémon" (metal.moveEnergy) is a Benched one.
      'Void Gale': {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'src' },
          { op: 'if', cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] }, then: [{ op: 'custom', fn: 'metal.moveEnergy', args: { from: 'src' } }] },
        ],
      },
    },
  },
  {
    id: 'me01-061',
    name: 'Shedinja',
    abilities: [
      {
        // "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon ex, your opponent can't take any Prize cards for it."
        name: 'Fragile Husk',
        statics: [{ effect: { k: 'koPrizes', none: true, attacker: { ex: true } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "This attack does 20 damage for each damage counter on your opponent's Active Pokémon."
      'Damage Beat': { damage: { mul: [20, { countersOn: 'defender' }] } },
    },
  },
  {
    id: 'me02.5-182',
    name: 'Anthea & Concordia',
    // "You can use this card only if you have N's Darmanitan, N's Zoroark ex, N's Vanilluxe, N's Klinklang, N's Reshiram, and N's Zekrom in play."
    playable: { and: N_SIX.map(inPlay) },
    // "During this turn, if your opponent's Active Pokémon is Knocked Out by damage from an attack used by your N's Pokémon, take 3 more Prize cards."
    play: [{ op: 'effect', static: { k: 'extraPrize', amount: 3, attacker: N_POKEMON }, onPlayer: 'self', duration: 'thisTurn' }],
  },

  // ---------------------------------------------------------------- Records of the opponent's last turn
  {
    id: 'me02.5-122',
    name: 'Okidogi',
    attacks: {
      // "This attack does 60 more damage for each Prize card your opponent took during their last turn."
      'Settle the Score': { damage: { add: [80, { mul: [60, { prizesTakenLastTurn: 'opp' }] }] } },
    },
  },
  {
    id: 'me02-004',
    name: 'Mega Heracross ex',
    attacks: {
      // "If this Pokémon was damaged by an attack during your opponent's last turn, this attack does that much more damage."
      // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2372/): yes, the Pokémon swapped in with Transformation Tome is treated as the same Pokémon, so the damage it took last turn counts (swapped in with Transformation Tome)
      // Ruling (Phantasmal Flames FAQ, TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2253/): placing damage counters doesn't count as damage from attacks.
      'Juggernaut Horn': { damage: { add: [100, { damageTakenLastTurn: 'self' }] } },
      // "Discard the top 2 cards of your opponent's deck."
      'Mountain Ramming': { post: DISCARD_TOP_2_OF_OPP },
    },
  },
  {
    id: 'me02.5-201',
    name: "Team Rocket's Archer",
    // "You can use this card only if any of your Team Rocket's Pokémon were Knocked Out during your opponent's last turn."
    playable: { koLastTurn: 'self', filter: { nameIncludes: "Team Rocket's" } },
    // "Each player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 3 cards."
    play: [...BOTH_HANDS_INTO_DECKS, { op: 'draw', n: 5 }, { op: 'draw', n: 3, who: 'opp' }],
  },

  // ---------------------------------------------------------------- Damage prevention and reduction
  {
    id: 'me03-024',
    name: 'Aurorus',
    abilities: [
      {
        // "All of your Pokémon that have any {W} Energy attached take 50 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Tundra Wall doesn't stack."
        name: 'Tundra Wall',
        statics: [
          {
            effect: { k: 'damageIn', amount: -50, fromOpp: true, noStack: 'Tundra Wall' },
            scope: 'myPokemon',
            filter: { energy: { providesType: 'Water' } },
          },
        ],
      },
    ],
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't use attacks."
      'Freezing Chill': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me02-093',
    name: 'Sacred Charm',
    // "The Pokémon this card is attached to takes 30 less damage from attacks from your opponent's Pokémon that have an Ability (after applying Weakness and Resistance)."
    // Ruling (Phantasmal Flames FAQ, TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2260/): with Team Rocket's Watchtower out, Colorless Pokemon have no Abilities, so Sacred Charm does not take 30 off their attacks.
    statics: [{ effect: { k: 'damageIn', amount: -30, fromOpp: true, attacker: { anyAbility: true } }, scope: 'self' }],
  },

  // ---------------------------------------------------------------- Knock Out survival, extra types
  {
    id: 'me02.5-116',
    name: 'Mega Hawlucha ex',
    abilities: [
      {
        // "If this Pokémon would be Knocked Out by damage from an attack, flip a coin. If heads, this Pokémon is not Knocked Out, and its remaining HP becomes 10."
        // Ruling (Ascending Heroes FAQ, TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2287/): Shred does its full damage first; only then, on heads, 10 HP is restored and Mega Hawlucha ex is not Knocked Out.
        name: 'Tenacious Body',
        statics: [{ effect: { k: 'surviveKoCoinFlip' }, scope: 'self' }],
      },
    ],
    attacks: {
      // "If a Stadium is in play, this attack does 140 more damage. Then, discard that Stadium."
      'Somersault Dive': {
        damage: { add: [120, { cond: { stadium: true }, then: 140, else: 0 }] },
        post: [{ op: 'custom', fn: 'std.discardStadium' }],
      },
    },
  },
  {
    id: 'me02.5-117',
    name: 'Carbink',
    abilities: [
      {
        // "As long as this Pokémon is in play, it is {F} and {P} type."
        // Weakness and Resistance (as the attacker) and type filters see both types; see StaticEffect `types`.
        name: 'Double Type',
        statics: [{ effect: { k: 'types', types: ['Fighting', 'Psychic'] }, scope: 'self' }],
      },
    ],
    attacks: {
      // "If your opponent has 2 or fewer Prize cards remaining, this attack does 100 more damage."
      'Counter Jewel': { damage: { add: [70, { cond: { lte: [{ prizesLeft: 'opp' }, 2] }, then: 100, else: 0 }] } },
    },
  },
];
