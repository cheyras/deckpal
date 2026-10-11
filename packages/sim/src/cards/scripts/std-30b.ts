/**
 * Card scripts for batch "std-30b" (Standard): 30th Celebration (30th-046 .. 30th-081) and the Mega promo reprints of Pikachu ex and
 * Mewtwo. Written from the printed text in the frames. One test per card in src/__tests__/cards-std-30b.test.ts.
 *
 * Not here: 30th-066 Mew ex (30th-152, 30th-158), Memory Helix, is scripted in std-30e.ts with the `borrowAttacks` static.
 */
import type { CardScript, Expr, PType } from '../../dsl.js';
import { BENCH_SPACE, damageOneOf, inDiscard, searchToHand } from './helpers.js';
import './std-c02-customs.js'; // c02.cureConditions
import './std-30b-customs.js';

/** One for each type of Basic Energy that at least one of your Pokémon has attached, 8 types in all (no Basic Colorless Energy exists). */
const BASIC_ENERGY_TYPES: PType[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
const TYPES_OF_BASIC_ENERGY_IN_PLAY: Expr = {
  add: BASIC_ENERGY_TYPES.map(
    (t): Expr => ({
      cond: { gte: [{ pokemon: { zone: 'myPokemon', filter: { energy: { energyType: t } } } }, 1] },
      then: 1,
      else: 0,
    }),
  ),
};

export const STD_30B: CardScript[] = [
  {
    id: '30th-046',
    name: 'Pikachu',
    attacks: {
      // "This Pokémon recovers from all Special Conditions."
      'Get Some Air': {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'me' },
          { op: 'custom', fn: 'c02.cureConditions', args: { slot: 'me' } },
        ],
      },
    },
  },
  {
    id: '30th-048',
    name: 'Pikachu',
    attacks: {
      // "Put up to 2 Basic Energy cards from your discard pile into your hand."
      'Store Up': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: 0, max: 2, as: 'e', prompt: 'Put up to 2 Basic Energy cards into your hand' },
          { op: 'move', cards: 'e', to: 'hand' },
        ],
      },
    },
  },
  {
    id: '30th-049',
    name: 'Pikachu',
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 80 more damage."
      'Fighting Lightning': {
        damage: { add: [20, { cond: { slotIs: { ref: 'oppActive', filter: { ex: true } } }, then: 80, else: 0 }] },
      },
    },
  },
  {
    id: '30th-051',
    name: 'Pikachu',
    attacks: {
      // "Discard all {L} Energy from this Pokémon, and this attack does 90 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Lightning Crash': {
        program: [
          { op: 'discardEnergy', from: 'self', count: 'all', filter: { providesType: 'Lightning' } },
          ...damageOneOf('oppPokemon', 90),
        ],
      },
    },
  },
  {
    id: '30th-053',
    name: 'Pikachu ex',
    attacks: {
      // "Search your deck for any number of Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
      'Pika-Pika Parade': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { cat: 'pokemon', stage: 'basic' }, min: 0, max: BENCH_SPACE, as: 'found', prompt: 'Put any number of Basic Pokémon onto your Bench' },
          { op: 'move', cards: 'found', to: 'bench' },
          { op: 'shuffle' },
        ],
      },
      // "Discard all Energy from this Pokémon."
      Thunderbolt: { post: [{ op: 'discardEnergy', from: 'self', count: 'all' }] },
    },
  },
  {
    id: '30th-055',
    name: 'Zapdos',
    abilities: [
      {
        // "Once during your turn, if you have Moltres and Articuno in play, you may use this Ability. Attach a Basic Lightning Energy card from your hand to this Pokémon."
        name: 'Flash-Pop Flapping',
        activated: {
          when: {
            and: [
              { gte: [{ pokemon: { zone: 'myPokemon', filter: { name: 'Moltres' } } }, 1] },
              { gte: [{ pokemon: { zone: 'myPokemon', filter: { name: 'Articuno' } } }, 1] },
              { gte: [{ count: { zone: 'hand', filter: { energyType: 'Lightning' } } }, 1] },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { energyType: 'Lightning' }, min: 1, max: 1, as: 'e', prompt: 'Attach which Basic Lightning Energy?' },
            { op: 'attach', cards: 'e', to: 'self' },
          ],
        },
      },
    ],
    attacks: {
      // "This Pokémon also does 60 damage to itself."
      'Thundering Lightning': { post: [{ op: 'damage', amount: 60, to: 'self' }] },
    },
  },
  {
    id: '30th-056',
    name: 'Zekrom',
    attacks: {
      // "If this Pokémon has any {R} Energy attached, this attack does 80 more damage."
      'Nitro Thunder': {
        damage: { add: [80, { cond: { gte: [{ energyOn: 'self', type: 'Fire' }, 1] }, then: 80, else: 0 }] },
      },
    },
  },
  {
    id: '30th-057',
    name: 'Zeraora',
    attacks: {
      // "Draw a card."
      'Rapid Draw': { post: [{ op: 'draw', n: 1 }] },
      // "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      Electrobullet: { post: damageOneOf('oppBench', 20) },
    },
  },
  {
    id: '30th-061',
    name: 'Morpeko',
    attacks: {
      // "Discard the top 3 cards of your deck and put 1 of them into your hand."
      'Select a Snack': { program: [{ op: 'custom', fn: 'n30b.discardTopPickToHand', args: { n: 3 } }] },
    },
  },
  {
    id: '30th-062',
    name: 'Miraidon',
    attacks: {
      // "Discard 2 {L} Energy from this Pokémon."
      'Electro Drift': { post: [{ op: 'discardEnergy', from: 'self', count: 2, filter: { providesType: 'Lightning' } }] },
    },
  },
  {
    id: '30th-063',
    name: 'Mewtwo',
    attacks: {
      // "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Pokémon."
      Empower: {
        program: [
          { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach the Energy to which of your Pokémon?' },
          { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: 0, max: 2, as: 'e', prompt: 'Attach up to 2 Basic Energy cards from your discard pile' },
          { op: 'attach', cards: 'e', to: { v: 't' } },
        ],
      },
      // "Discard an Energy from this Pokémon."
      Psydrive: { post: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
    },
  },
  {
    id: '30th-064',
    name: 'Mewtwo ex',
    attacks: {
      // "This attack does 50 damage to each of your opponent's Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Photon Bullets': { program: [{ op: 'damage', amount: 50, to: { each: 'oppPokemon', filter: { ex: true } } }] },
      // "During your next turn, this Pokémon can't use attacks."
      'Psychic Powers': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: '30th-068',
    name: 'Azumarill',
    fix: { evolvesFrom: 'Marill' },
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Body Slam': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }] },
        ],
      },
    },
  },
  {
    id: '30th-069',
    name: 'Espeon',
    fix: { evolvesFrom: 'Eevee' },
    attacks: {
      // "Devolve each of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."
      'Miraculous Shine': { program: [{ op: 'custom', fn: 'n30b.devolveOppAllToHand' }] },
    },
  },
  {
    id: '30th-071',
    name: 'Sylveon ex',
    attacks: {
      // "This attack does 50 damage for each type of Basic Energy attached to all of your Pokémon."
      'Colorful Harmony': { damage: { mul: [50, TYPES_OF_BASIC_ENERGY_IN_PLAY] } },
    },
  },
  {
    id: '30th-072',
    name: 'Unown',
    attacks: {
      // "If your opponent's Pokémon is Knocked Out by damage from this attack, take 1 more Prize card."
      'Mysterious Signal': {
        pre: [{ op: 'effect', static: { k: 'extraPrize', amount: 1, attacker: { name: 'Unown' } }, onPlayer: 'self', duration: 'thisTurn' }],
      },
    },
  },
  {
    id: '30th-075',
    name: 'Chandelure',
    fix: { evolvesFrom: 'Lampent' },
    attacks: {
      // "Your opponent's Active Pokémon is now Burned and Confused."
      'Eerie Glow': {
        post: [
          { op: 'condition', cond: 'burned', to: 'oppActive' },
          { op: 'condition', cond: 'confused', to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: '30th-076',
    name: 'Xerneas',
    attacks: {
      // "Search your deck for up to 2 Stadium cards, reveal them, and put them into your hand. Then, shuffle your deck."
      Geonavigation: { program: searchToHand({ ttype: 'stadium' }, 2, { reveal: true }) },
    },
  },
  {
    id: '30th-077',
    name: 'Comfey',
    attacks: {
      // "Heal 80 damage from 1 of your Benched Pokémon."
      'Comforting Aroma': {
        program: [
          { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Choose a Benched Pokémon to heal' },
          { op: 'heal', amount: 80, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: '30th-079',
    name: 'Cosmoem',
    fix: { evolvesFrom: 'Cosmog' },
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 60 less damage from attacks (after applying Weakness and Resistance)."
      Stiffen: { post: [{ op: 'effect', static: { k: 'damageIn', amount: -60 }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: '30th-080',
    name: 'Lunala',
    fix: { evolvesFrom: 'Cosmoem' },
    attacks: {
      // "This attack does 20 more damage for each Energy card in your discard pile."
      'Midnight Ray': { damage: { add: [20, { mul: [20, inDiscard({ cat: 'energy' })] }] } },
    },
  },
  {
    id: '30th-081',
    name: 'Gimmighoul',
    attacks: {
      // "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck."
      'Strolls So Much': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: searchToHand({}, 1, { reveal: false }) },
        ],
      },
    },
  },
];
