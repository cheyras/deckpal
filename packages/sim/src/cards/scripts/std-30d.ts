/**
 * Standard batch 30d: cards of the 30th Celebration set and the Mega promos (mep-*) whose text no earlier script covers.
 * Each script is written from the printed text in frames; quotes below are that text.
 *
 * Trainers 30th-126 Poké Pad, 30th-127 Switch and 30th-128 Ultra Ball: the catalog frames of these printings carry no Trainer
 * text at all (effect null), so the script follows the text printed on their earlier printings (me03-081, me01-130, me01-131),
 * which they reprint unchanged.
 */
import type { CardScript, Cond, Filter } from '../../dsl.js';
import { BENCH_SPACE, damageOneOf, discardOthers, NO_RULE_BOX, searchToHand } from './helpers.js';
import './std-seed1-customs.js'; // std.revealHand
import './std-c01-customs.js'; // c01.benchCards
import './std-c02-customs.js'; // c02.takePrize
import './std-engine7-customs.js'; // engine7.swapTopCard
import './std-30d-customs.js';

/** "Flip a coin. If heads, ..." */
const HEADS: Cond = { gte: [{ v: 'h' }, 1] };

const BASIC_FIRE: Filter = { basicEnergy: true, energyType: 'Fire' };
const BASIC_WATER: Filter = { basicEnergy: true, energyType: 'Water' };
const BASIC_LIGHTNING: Filter = { basicEnergy: true, energyType: 'Lightning' };

/** "if you have <a> and <b> in play": a Pokémon of each name among your Pokémon. */
function haveInPlay(a: string, b: string): Cond {
  return {
    and: [
      { gte: [{ pokemon: { zone: 'myPokemon', filter: { name: a } } }, 1] },
      { gte: [{ pokemon: { zone: 'myPokemon', filter: { name: b } } }, 1] },
    ],
  };
}

/** The Legendary-bird Ability: "Attach a Basic <type> Energy card from your hand to this Pokémon." */
function flapping(name: string, others: [string, string], energy: Filter, label: string): CardScript['abilities'] {
  return [
    {
      name,
      activated: {
        when: { and: [haveInPlay(others[0], others[1]), { gte: [{ count: { zone: 'hand', filter: energy } }, 1] }] },
        program: [
          { op: 'chooseCards', from: 'hand', filter: energy, min: 1, max: 1, as: 'e', prompt: `Attach a Basic ${label} Energy card` },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
      },
    },
  ];
}

export const STD_30D: CardScript[] = [
  {
    id: '30th-108',
    name: 'Gholdengo',
    attacks: {
      // "If you have exactly 30 cards in your hand, take 2 Prize cards. If you do, shuffle your hand into your deck."
      // (The 2 Prize cards go to the hand, so they are shuffled in with the rest of it.)
      Celebration: {
        program: [
          {
            op: 'if',
            cond: { eq: [{ handSize: 'self' }, 30] },
            then: [
              { op: 'repeat', n: 2, body: [{ op: 'custom', fn: 'c02.takePrize', args: { who: 'self' } }] },
              { op: 'move', cards: { all: 'hand' }, to: 'deck' },
              { op: 'shuffle' },
            ],
          },
        ],
      },
      // "Flip 3 coins. This attack does 50 damage for each heads."
      'Triple Smash': { pre: [{ op: 'flip', n: 3, as: 'h' }], damage: { mul: [50, { v: 'h' }] } },
    },
  },
  {
    id: '30th-109',
    name: 'Salamence ex',
    attacks: {
      // "Put up to 3 {N} Pokémon from your discard pile onto your Bench."
      // ("Up to" on an attack is 0 to 3.) Any Stage goes onto the Bench as the card it is (c01.benchCards), as many as there is room for.
      'Booming Call': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon', type: 'Dragon' }, min: 0, max: { min: [3, BENCH_SPACE] }, as: 'found', prompt: 'Put up to 3 {N} Pokémon onto your Bench' },
          { op: 'custom', fn: 'c01.benchCards', args: { cards: 'found' } },
        ],
      },
      // "Discard the top 2 cards of your deck."
      'Dragon Pulse': { post: [{ op: 'move', cards: { top: 2 }, to: 'discard' }] },
    },
  },
  {
    id: '30th-110',
    name: 'Jangmo-o',
    attacks: {
      // "During your next turn, the Defending Pokémon takes 30 more damage from attacks (after applying Weakness and Resistance)."
      Screech: { post: [{ op: 'effect', static: { k: 'damageIn', amount: 30 }, on: 'defender', duration: 'myNextTurn' }] },
    },
  },
  {
    id: '30th-113',
    name: 'Meowth',
    attacks: {
      // "Draw a card."
      'Pay Day': { post: [{ op: 'draw', n: 1 }] },
    },
  },
  {
    id: '30th-115',
    name: 'Ditto',
    attacks: {
      // "Flip a coin. If heads, search your deck for a Pokémon and switch it with this Pokémon. Any attached cards, damage counters,
      // Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way,
      // put this card into your deck. Then, shuffle your deck."
      // (The found card takes Ditto's place as the top card of the Pokémon, whatever its Stage; Ditto goes into the deck, and the
      // deck is shuffled after it. The search may be declined.)
      'Surprisingly Transform': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: HEADS,
            then: [
              { op: 'chooseCards', from: 'deck', filter: { cat: 'pokemon' }, min: 0, max: 1, as: 'x', prompt: 'Search your deck for a Pokémon to switch with Ditto' },
              { op: 'if', cond: { gte: [{ len: 'x' }, 1] }, then: [{ op: 'custom', fn: 'engine7.swapTopCard', args: { cards: 'x' } }] },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    },
  },
  {
    id: '30th-116',
    name: 'Eevee',
    attacks: {
      // "Your opponent reveals their hand, and you put an Item card you find there on the bottom of your opponent's deck."
      'Fetch and Hide': {
        program: [
          { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
          { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'self', filter: { ttype: 'item' }, min: 1, max: 1, as: 'x', prompt: "Put an Item card from your opponent's hand on the bottom of their deck" },
          { op: 'move', cards: 'x', to: 'deckBottom', who: 'opp' },
        ],
      },
    },
  },
  {
    id: '30th-119',
    name: 'Snorlax',
    abilities: [
      {
        // "If this Pokémon remains Asleep during Pokémon Checkup, heal all damage from this Pokémon."
        // (Checkup abilities resolve after the Asleep flip, so a Snorlax that woke up is not healed.)
        name: 'Good Sleep',
        triggers: [
          {
            on: 'checkup',
            when: { slotIs: { ref: 'self', filter: { condition: 'asleep' } } },
            program: [{ op: 'heal', amount: { mul: [10, { countersOn: 'self' }] }, to: 'self' }],
          },
        ],
      },
    ],
    attacks: {
      // "This Pokémon is now Asleep."
      Collapse: { post: [{ op: 'condition', cond: 'asleep', to: 'self' }] },
    },
  },
  {
    id: '30th-120',
    name: 'Igglybuff',
    attacks: {
      // "This attack does 30 damage for each of your Benched Pokémon that has a maximum HP of 30."
      'Bouncy Circle': {
        pre: [{ op: 'custom', fn: 'n30d.benchWithMaxHp', args: { hp: 30, as: 'n' } }],
        damage: { mul: [30, { v: 'n' }] },
      },
    },
  },
  {
    id: '30th-121',
    name: 'Lugia',
    attacks: {
      // "Discard a {R} Energy, a {W} Energy, and a {L} Energy from this Pokémon."
      // ("{X} Energy" is any Energy card providing {X}, Basic or Special; each is a different card.)
      'Elemental Blast': {
        post: [
          { op: 'discardEnergy', from: 'self', count: 1, filter: { providesType: 'Fire' } },
          { op: 'discardEnergy', from: 'self', count: 1, filter: { providesType: 'Water' } },
          { op: 'discardEnergy', from: 'self', count: 1, filter: { providesType: 'Lightning' } },
        ],
      },
    },
  },
  {
    id: '30th-124',
    name: 'Minior',
    attacks: {
      // "Discard all Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Shoot Meteors': {
        program: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          ...damageOneOf('oppPokemon', 120),
        ],
      },
    },
  },
  {
    id: '30th-125',
    name: 'Maushold',
    attacks: {
      // "Flip a coin for each Maushold you have in play. For each heads, discard the top 2 cards of your opponent's deck."
      // (Maushold ex is a different name.)
      'Gnaw Together': {
        program: [
          { op: 'flip', n: { pokemon: { zone: 'myPokemon', filter: { name: 'Maushold' } } }, as: 'h' },
          { op: 'repeat', n: { v: 'h' }, body: [{ op: 'move', cards: { top: 2, who: 'opp' }, to: 'discard', who: 'opp' }] },
        ],
      },
    },
  },
  {
    id: '30th-126',
    name: 'Poké Pad',
    // "Search your deck for a Pokémon that doesn't have a Rule Box, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand(NO_RULE_BOX),
  },
  {
    id: '30th-127',
    name: 'Switch',
    playable: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
    // "Switch your Active Pokémon with 1 of your Benched Pokémon."
    play: [{ op: 'switch', who: 'self' }],
  },
  {
    id: '30th-128',
    name: 'Ultra Ball',
    // "You can use this card only if you discard 2 other cards from your hand."
    // Ruling (TPCi Rules Team 2017-04-27, https://compendium.pokegym.net/ruling/1188/): "No, you cannot. Discarding the two cards is a cost not the effect, and you cannot play Trainer cards for no effect." (an empty deck)
    playable: { and: [{ gte: [{ handSize: 'self' }, 3] }, { gte: [{ deckSize: 'self' }, 1] }] },
    // "Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
    play: [...discardOthers(2), ...searchToHand({ cat: 'pokemon' })],
  },
  {
    id: 'mep-094',
    name: 'Alolan Exeggutor',
    abilities: [
      {
        // "If this Pokémon has 6 or more {G} Energy attached, it gets +250 HP."
        name: 'Scale Up',
        statics: [{ effect: { k: 'hp', delta: 250 }, scope: 'self', when: { gte: [{ energyOn: 'self', type: 'Grass' }, 6] } }],
      },
    ],
    attacks: {
      // "Heal 50 damage from this Pokémon."
      'Mega Drain': { post: [{ op: 'heal', amount: 50, to: 'self' }] },
    },
  },
  {
    id: 'mep-096',
    name: 'Moltres',
    // "Once during your turn, if you have Articuno and Zapdos in play, you may use this Ability. Attach a Basic {R} Energy card from your hand to this Pokémon."
    abilities: flapping('Fiery Flapping', ['Articuno', 'Zapdos'], BASIC_FIRE, '{R}'),
    attacks: {
      // "Discard 2 Energy from this Pokémon."
      'Fire Spin': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'mep-097',
    name: 'Articuno',
    // "Once during your turn, if you have Moltres and Zapdos in play, you may use this Ability. Attach a Basic {W} Energy card from your hand to this Pokémon."
    abilities: flapping('Frosty Flapping', ['Moltres', 'Zapdos'], BASIC_WATER, '{W}'),
    attacks: {
      // "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      Hail: { program: [{ op: 'damage', amount: 30, to: { each: 'oppPokemon' } }] },
    },
  },
  {
    id: 'mep-098',
    name: 'Zapdos',
    // "Once during your turn, if you have Moltres and Articuno in play, you may use this Ability. Attach a Basic {L} Energy card from your hand to this Pokémon."
    abilities: flapping('Flash-Pop Flapping', ['Moltres', 'Articuno'], BASIC_LIGHTNING, '{L}'),
    attacks: {
      // "This Pokémon also does 60 damage to itself."
      'Thundering Lightning': { post: [{ op: 'damage', amount: 60, to: 'self' }] },
    },
  },
  {
    id: 'mep-099',
    name: 'Greninja ex',
    attacks: {
      // "This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Stealthy Slash': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: 'Choose a Pokémon to damage' },
          { op: 'damage', amount: { mul: [30, { countersOn: { v: 't' } }] }, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'mep-100',
    name: 'Sylveon ex',
    attacks: {
      // "This attack does 50 damage for each type of Basic Energy attached to all of your Pokémon."
      'Colorful Harmony': {
        pre: [{ op: 'custom', fn: 'n30d.basicEnergyTypes', args: { as: 'n' } }],
        damage: { mul: [50, { v: 'n' }] },
      },
    },
  },
  {
    id: 'mep-101',
    name: 'Nidorina',
    abilities: [
      {
        // "Once during your turn, you may use this Ability. Heal 30 damage from 1 of your Pokémon."
        // Usable only while some Pokémon of yours is damaged.
        name: 'Share Happiness',
        activated: {
          when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] },
          program: [
            { op: 'chooseSlots', from: 'myPokemon', filter: { damaged: true }, min: 1, max: 1, as: 't', prompt: 'Heal 30 damage from which of your Pokémon?' },
            { op: 'heal', amount: 30, to: { v: 't' } },
          ],
        },
      },
    ],
  },
  // mep-103 Zeraora has the same text as 30th-057 (the catalog's HTML energy symbols are cleaned at entry): scripted once, in std-30b.
  {
    id: 'mep-110',
    name: 'Umbreon ex',
    attacks: {
      // "If your opponent's Active Pokémon already has any damage counters on it, this attack does 140 more damage."
      'Lunatic Claw': { damage: { add: [100, { cond: { gte: [{ countersOn: 'oppActive' }, 1] }, then: 140, else: 0 }] } },
    },
  },
];

