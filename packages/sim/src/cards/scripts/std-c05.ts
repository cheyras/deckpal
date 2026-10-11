/**
 * Standard batch c05: Pokémon of Mega Evolution - Perfect Order (me02.5) whose text no earlier script covered.
 * Each script is written from the printed text in frames; quotes below are that text.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - me02.5-064 Heliolisk: Frilled Generator needs "you played Canari from your hand this turn" (no record of which
 *    named card was played this turn).
 *  - me02.5-067 Tapu Koko: Fast Flight is "If you go first, you can use this attack during your first turn".
 *  - me02.5-101 Team Rocket's Dugtrio: Holes needs a trigger for "your opponent's Active Pokémon moves to the Bench".
 *  - me02.5-116 Mega Hawlucha ex: Tenacious Body is a coin-flip Knock Out survival static.
 *  - me02.5-117 Carbink: Double Type adds a second type to the Pokémon.
 *  - me02.5-122 Okidogi: Settle the Score counts Prize cards taken during the opponent's last turn.
 */
import type { CardScript, Cond, Step } from '../../dsl.js';
import { searchToBench } from './helpers.js';
import './std-c05-customs.js';
import './std-seed1-customs.js';

/** "heads" after `{ op: 'flip', n: 1, as: 'h' }`. */
const HEADS: Cond = { gte: [{ v: 'h' }, 1] };
const FLIP: Step = { op: 'flip', n: 1, as: 'h' };
const BASIC_L = { cat: 'energy', energyType: 'Lightning' } as const;
const IONO = { nameIncludes: "Iono's" } as const;
const ROCKET = { nameIncludes: "Team Rocket's" } as const;
/** The Defending Pokémon is affected by any Special Condition. */
const DEFENDER_AFFECTED: Cond = {
  or: (['asleep', 'confused', 'paralyzed', 'poisoned', 'burned'] as const).map((c) => ({ slotIs: { ref: 'defender' as const, filter: { condition: c } } })),
};

export const STD_C05: CardScript[] = [
  {
    id: 'me02.5-062',
    name: 'Stunfisk',
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat. During your next turn, the Defending Pokémon takes 100 more damage from attacks (after applying Weakness and Resistance)."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2341/): the extra-damage effect is not applied to a Pokémon already protected by Mist Energy; attaching Mist Energy afterwards does not remove an effect already applied.
      // Both are effects the attack puts on the Defending Pokémon, so a Pokémon that prevents the attack's effects takes neither.
      'Pouncing Trap': {
        post: [
          { op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' },
          { op: 'effect', static: { k: 'damageIn', amount: 100 }, on: 'defender', duration: 'myNextTurn' },
        ],
      },
    },
  },
  {
    id: 'me02.5-066',
    name: 'Vikavolt',
    attacks: {
      // "Switch this Pokémon with 1 of your Benched {L} Pokémon."
      'Volt Switch': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench', filter: { type: 'Lightning' } } }, 1] },
            then: [
              { op: 'chooseSlots', from: 'myBench', filter: { type: 'Lightning' }, min: 1, max: 1, as: 't', prompt: 'Switch with which Benched {L} Pokémon?' },
              { op: 'switch', who: 'self', with: { v: 't' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'me02.5-068',
    name: "Hop's Pincurchin ex",
    abilities: [
      {
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon."
        // The Attacking Pokémon is the opponent's Active Pokémon.
        name: 'Counterattack Quills',
        triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'counters', n: 3, to: 'oppActive' }] }],
      },
    ],
    attacks: {
      // "Draw 2 cards."
      'Spiky Thunder': { post: [{ op: 'draw', n: 2 }] },
    },
  },
  {
    id: 'me02.5-070',
    name: "Iono's Bellibolt ex",
    abilities: [
      {
        // "As often as you like during your turn, you may attach a Basic {L} Energy card from your hand to 1 of your Iono's Pokémon."
        name: 'Electric Streamer',
        activated: {
          oncePerTurn: false,
          when: {
            and: [
              { gte: [{ count: { zone: 'hand', filter: BASIC_L } }, 1] },
              { gte: [{ pokemon: { zone: 'myPokemon', filter: IONO } }, 1] },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'hand', filter: BASIC_L, min: 1, max: 1, as: 'e', prompt: 'Choose a Basic {L} Energy' },
            { op: 'chooseSlots', from: 'myPokemon', filter: IONO, min: 1, max: 1, as: 't', prompt: "Attach it to which of your Iono's Pokémon?" },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't attack."
      'Thunderous Bolt': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'me02.5-072',
    name: "Iono's Kilowattrel",
    abilities: [
      {
        // "You must discard a Basic {L} Energy from this Pokémon in order to use this Ability. Once during your turn, you may draw cards until you have 6 cards in your hand."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2108/): the Ability draws cards, so it cannot be used with an empty deck or with 6 or more cards already in hand.
        // -- so it needs a Basic {L} Energy to pay, a card in the deck, and fewer than 6 cards in hand.
        name: 'Flashing Draw',
        activated: {
          when: {
            and: [
              { slotIs: { ref: 'self', filter: { energy: { energyType: 'Lightning' } } } },
              { lt: [{ handSize: 'self' }, 6] },
              { gte: [{ deckSize: 'self' }, 1] },
            ],
          },
          program: [
            { op: 'discardEnergy', from: 'self', count: 1, filter: { energyType: 'Lightning' } },
            { op: 'draw', n: { sub: [6, { handSize: 'self' }] } },
          ],
        },
      },
    ],
  },
  {
    id: 'me02.5-073',
    name: 'Miraidon ex',
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 120 more damage."
      'Hadron Spark': {
        damage: { add: [120, { cond: { slotIs: { ref: 'defender', filter: { ex: true } } }, then: 120, else: 0 }] },
      },
    },
  },
  {
    id: 'me02.5-078',
    name: "Team Rocket's Exeggutor",
    attacks: {
      // "Flip 3 coins. If all of them are heads, Knock Out 1 of your opponent's Pokémon."
      'Tri Kinesis': {
        program: [
          { op: 'flip', n: 3, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 3] },
            then: [
              { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: 'Knock Out which of your opponent\'s Pokémon?' },
              { op: 'knockOut', target: { v: 't' } },
            ],
          },
        ],
      },
      // "This Pokémon also does 30 damage to itself."
      'Double-Edge': { post: [{ op: 'damage', amount: 30, to: 'self' }] },
    },
  },
  {
    id: 'me02.5-079',
    name: "Team Rocket's Mewtwo ex",
    abilities: [
      {
        // "This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in play."
        name: 'Power Saver',
        statics: [
          {
            effect: { k: 'cantAttack' },
            scope: 'self',
            when: { lt: [{ pokemon: { zone: 'myPokemon', filter: ROCKET } }, 4] },
          },
        ],
      },
    ],
    attacks: {
      // "You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2340/): Team Rocket's Energy counts as one card; combine with other cards for more damage.
      // -- the choice is of up to 2 Energy CARDS, and each card discarded adds 60.
      'Erasure Ball': {
        pre: [{ op: 'custom', fn: 'c05.discardBenchEnergy', args: { max: 2, as: 'n' } }],
        damage: { add: [160, { mul: [60, { v: 'n' }] }] },
      },
    },
  },
  {
    id: 'me02.5-083',
    name: 'Marill',
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon."
      Hide: {
        program: [
          FLIP,
          { op: 'if', cond: HEADS, then: [{ op: 'effect', static: { k: 'preventDamage', andEffects: true }, on: 'self', duration: 'oppNextTurn' }] },
        ],
      },
    },
  },
  {
    id: 'me02.5-084',
    name: 'Azumarill ex',
    abilities: [
      {
        // "As often as you like during your turn, you may use this Ability. Move an Energy from 1 of your other Pokémon to this Pokémon."
        // (Usable only while one of your other Pokémon has an Energy to move.)
        name: 'Bubble Gathering',
        activated: {
          oncePerTurn: false,
          when: {
            gt: [
              { pokemon: { zone: 'myPokemon', filter: { energized: true } } },
              { cond: { slotIs: { ref: 'self', filter: { energized: true } } }, then: 1, else: 0 },
            ],
          },
          program: [{ op: 'custom', fn: 'c05.moveEnergyToSelf' }],
        },
      },
    ],
    attacks: {
      // "This attack does 40 more damage for each {P} Energy attached to this Pokémon."
      'Energized Balloon': { damage: { add: [60, { mul: [40, { energyOn: 'self', type: 'Psychic' }] }] } },
    },
  },
  {
    id: 'me02.5-086',
    name: 'Mismagius',
    attacks: {
      // "If your opponent's Active Pokémon is affected by a Special Condition, place 6 damage counters on 1 of your opponent's Benched Pokémon."
      "Assassin's Magic": {
        post: [
          {
            op: 'if',
            cond: { and: [DEFENDER_AFFECTED, { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }] },
            then: [
              { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: 'Place 6 damage counters on which Benched Pokémon?' },
              { op: 'counters', n: 6, to: { v: 't' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'me02.5-091',
    name: 'Banette',
    attacks: {
      // "Your opponent chooses 3 cards from their hand and shuffles those cards into their deck."
      'Cursed Words': {
        program: [
          { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'opp', min: 3, max: 3, as: 'x', prompt: 'Choose 3 cards from your hand to shuffle into your deck' },
          { op: 'move', cards: 'x', to: 'deck', who: 'opp' },
          { op: 'shuffle', who: 'opp' },
        ],
      },
    },
  },
  {
    id: 'me02.5-092',
    name: 'Rotom',
    attacks: {
      // "You may search your deck for any number of Pokémon that have "Rotom" in their name and put them onto your Bench. Then, shuffle your deck."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2292/): any Pokémon with Rotom in its name can be chosen.
      // -- any Rotom Pokémon of any kind, as many as fit on the Bench (only Basic Pokémon can be put onto the Bench).
      'Roto Call': { program: searchToBench({ nameIncludes: 'Rotom' }, 5) },
      // "This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."
      // One Tool per Pokémon, so the Pokémon that have a Tool are the Tools.
      'Gadget Show': { damage: { mul: [30, { pokemon: { zone: 'myPokemon', filter: { tool: true } } }] } },
    },
  },
  {
    id: 'me02.5-097',
    name: "Team Rocket's Mimikyu",
    attacks: {
      // "Choose 1 of your opponent's Active Tera Pokémon's attacks and use it as this attack."
      // Nothing happens unless the opponent's Active Pokémon is a Tera Pokémon.
      'Gemstone Mimicry': {
        program: [
          {
            op: 'if',
            cond: { slotIs: { ref: 'defender', filter: { tera: true } } },
            then: [
              { op: 'chooseSlots', from: 'oppActive', min: 1, max: 1, as: 't', prompt: "Your opponent's Active Tera Pokémon" },
              { op: 'custom', fn: 'slotTopCard', args: { from: 't', as: 'c' } },
              { op: 'useAttackOf', card: 'c' },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'me02.5-100',
    name: "Team Rocket's Diglett",
    attacks: {
      // "Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck."
      'Relentless Burrowing': {
        program: [
          { op: 'flip', n: 'untilTails', as: 'h' },
          { op: 'repeat', n: { v: 'h' }, body: [{ op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' }] },
        ],
      },
    },
  },
  {
    id: 'me02.5-114',
    name: 'Stunfisk ex',
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Big Bite': { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
      // "If this Pokémon has any damage counters on it, this attack does 100 more damage."
      'Flopping Trap': {
        damage: { add: [100, { cond: { slotIs: { ref: 'self', filter: { damaged: true } } }, then: 100, else: 0 }] },
      },
    },
  },
  {
    id: 'me02.5-119',
    name: 'Carkol',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance)."
      'Guard Press': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -20 }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me02.5-120',
    name: 'Coalossal',
    attacks: {
      // "This attack does 140 damage to 1 of your opponent's Pokémon. If you don't have 10 or more Basic {F} Energy cards in your discard pile, this attack does nothing. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Tar Cannon': {
        program: [
          {
            op: 'if',
            cond: { gte: [{ count: { zone: 'discard', filter: { energyType: 'Fighting' } } }, 10] },
            then: [
              { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: 'Do 140 damage to which of your opponent\'s Pokémon?' },
              { op: 'damage', amount: 140, to: { v: 't' } },
            ],
          },
        ],
      },
      // "Discard 3 Energy from this Pokémon."
      'Bulky Bump': { post: [{ op: 'discardEnergy', from: 'self', count: 3 }] },
    },
  },
  {
    id: 'me02.5-121',
    name: 'Koraidon ex',
    attacks: {
      // "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 120 more damage."
      // (Same condition and wording as Krookodile, Vengeful Fang -- Ruling 2245: the Knock Out itself counts, not the Prize cards.)
      'Orichalcum Fang': { damage: { add: [50, { cond: { custom: 'std.attackKoLastTurn' }, then: 120, else: 0 }] } },
      // "During your next turn, this Pokémon can't use Impact Blow."
      'Impact Blow': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Impact Blow' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
];
