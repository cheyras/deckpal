/**
 * Scarlet & Violet era (sv05 Temporal Forces … sv10.5 Black Bolt/White Flare,
 * sv06.5 Shrouded Fable, sv08.5 Prismatic Evolutions) still legal in Standard (H, I, J).
 */
import type { CardScript } from '../../dsl.js';
import { NO_RULE_BOX, damageOneOf, discardOthers, searchToBench } from './helpers.js';

export const SV: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv06.5-038',
    name: 'Fezandipiti ex',
    abilities: [
      {
        // "Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip the Script Ability each turn."
        name: 'Flip the Script',
        activated: { program: [{ op: 'draw', n: 3 }], globalOncePerTurn: true, when: { koLastTurn: 'self' } },
      },
    ],
    attacks: {
      // "This attack does 100 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Cruel Arrow': { program: damageOneOf('oppPokemon', 100) },
    },
  },
  {
    id: 'sv08.5-079',
    name: 'Dunsparce',
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon."
      Dig: {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [{ op: 'effect', static: { k: 'preventDamage', andEffects: true }, on: 'self', duration: 'oppNextTurn' }],
          },
        ],
      },
    },
  },
  {
    id: 'sv08.5-080',
    name: 'Dudunsparce',
    abilities: [
      {
        // "Once during your turn, you may draw 3 cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck."
        name: 'Run Away Draw',
        activated: { program: [{ op: 'custom', fn: 'runAwayDraw', args: { n: 3 } }] },
      },
    ],
  },
  {
    id: 'sv06-141',
    name: 'Bloodmoon Ursaluna ex',
    abilities: [
      {
        // "Blood Moon used by this Pokémon costs {C} less for each Prize card your opponent has taken."
        name: 'Seasoned Skill',
        statics: [{ effect: { k: 'attackCostC', attack: 'Blood Moon', delta: { mul: [-1, { prizesTaken: 'opp' }] } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't attack."
      'Blood Moon': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv07-058',
    name: 'Slowking',
    attacks: {
      // "Discard the top card of your deck, and if that card is a Pokémon that doesn't have a Rule Box, choose 1 of its attacks and use it as this attack."
      'Seek Inspiration': {
        program: [
          { op: 'move', cards: { top: 1 }, to: 'discard', as: 'x' },
          { op: 'if', cond: { cardIs: { v: 'x', filter: NO_RULE_BOX } }, then: [{ op: 'useAttackOf', card: 'x' }] },
        ],
      },
    },
  },
  {
    id: 'sv08-100',
    name: 'Annihilape',
    attacks: {
      // "This Pokémon is now Confused."
      Tantrum: { post: [{ op: 'condition', cond: 'confused', to: 'self' }] },
      // "Both Active Pokémon are Knocked Out."
      'Destined Fight': { program: [{ op: 'knockOut', target: 'myActive' }, { op: 'knockOut', target: 'oppActive' }] },
    },
  },
  {
    id: 'sv06.5-047',
    name: 'Kyurem',
    abilities: [
      {
        // "If your opponent has any cards in their discard pile that have "Colress" in the name, this Pokémon can use the Trifrost attack for {C}."
        name: 'Plasma Bane',
        statics: [
          {
            effect: { k: 'attackCostSet', attack: 'Trifrost', cost: ['Colorless'] },
            scope: 'self',
            when: { gte: [{ count: { zone: 'discard', who: 'opp', filter: { nameIncludes: 'Colress' } } }, 1] },
          },
        ],
      },
    ],
    attacks: {
      // "Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      Trifrost: {
        program: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          { op: 'chooseSlots', from: 'oppPokemon', min: 3, max: 3, as: 't', prompt: 'Choose 3 of your opponent\'s Pokémon' },
          { op: 'damage', amount: 110, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'sv10-078',
    name: 'Zeraora',
    attacks: {
      // "Discard all Energy from this Pokémon, and this attack does 210 damage to 1 of your opponent's Benched Pokémon ex."
      'Thunder Raid': {
        program: [{ op: 'discardEnergy', from: 'self', count: 'all' }, ...damageOneOf('oppBench', 210, { ex: true })],
      },
    },
  },
  {
    id: 'sv08-076',
    name: 'Latias ex',
    abilities: [
      // "Your Basic Pokémon in play have no Retreat Cost."
      { name: 'Skyliner', statics: [{ effect: { k: 'retreatCost', set: 0 }, scope: 'myPokemon', filter: { stage: 'basic' } }] },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't attack."
      'Eon Blade': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv05-024',
    name: 'Rabsca',
    abilities: [
      // "Prevent all damage from and effects of attacks from your opponent's Pokémon done to your Benched Pokémon."
      { name: 'Spherical Shield', statics: [{ effect: { k: 'preventDamage', andEffects: true }, scope: 'myBench' }] },
    ],
    attacks: {
      // "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon."
      Psychic: { damage: { add: [10, { mul: [30, { energyOn: 'oppActive' }] }] } },
    },
  },
  {
    id: 'sv08-013',
    name: 'Rellor',
    attacks: { Collect: { program: [{ op: 'draw', n: 1 }] } },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv08.5-101',
    name: 'Buddy-Buddy Poffin',
    // "Search your deck for up to 2 Basic Pokémon with 70 HP or less and put them onto your Bench. Then, shuffle your deck."
    playable: { not: { benchFull: 'self' } },
    play: searchToBench({ hpMax: 70 }, 2),
  },
  {
    id: 'sv06-163',
    name: 'Secret Box',
    fix: { aceSpec: true },
    // "You can use this card only if you discard 3 other cards from your hand.
    //  Search your deck for an Item card, a Pokémon Tool card, a Supporter card, and a Stadium card, reveal them, and put them into your hand. Then, shuffle your deck."
    playable: { gte: [{ handSize: 'self' }, 4] },
    play: [
      ...discardOthers(3),
      {
        op: 'chooseCards',
        from: 'deck',
        min: 0,
        max: 4,
        as: 'found',
        reveal: true,
        oneEach: [{ ttype: 'item' }, { ttype: 'tool' }, { ttype: 'supporter' }, { ttype: 'stadium' }],
      },
      { op: 'move', cards: 'found', to: 'hand' },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'sv10.5b-079',
    name: 'Air Balloon',
    // "The Retreat Cost of the Pokémon this card is attached to is {C}{C} less."
    statics: [{ effect: { k: 'retreatCost', delta: -2 }, scope: 'self' }],
  },
  {
    id: 'sv06.5-061',
    name: 'Night Stretcher',
    // "Put a Pokémon or a Basic Energy card from your discard pile into your hand."
    playable: { gte: [{ count: { zone: 'discard', filter: { any: [{ cat: 'pokemon' }, { basicEnergy: true }] } } }, 1] },
    play: [
      { op: 'chooseCards', from: 'discard', filter: { any: [{ cat: 'pokemon' }, { basicEnergy: true }] }, min: 1, max: 1, as: 'x' },
      { op: 'move', cards: 'x', to: 'hand' },
    ],
  },
  {
    id: 'sv06.5-054',
    name: 'Academy at Night',
    // "Once during each player's turn, that player may put a card from their hand on top of their deck."
    stadiumAbility: {
      when: { gte: [{ handSize: 'self' }, 1] },
      program: [
        { op: 'chooseCards', from: 'hand', min: 1, max: 1, as: 'x', prompt: 'Put a card on top of your deck' },
        { op: 'move', cards: 'x', to: 'deckTop' },
      ],
    },
  },
  {
    id: 'sv08.5-104',
    name: "Ciphermaniac's Codebreaking",
    // "Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order."
    play: [
      { op: 'chooseCards', from: 'deck', min: 2, max: 2, as: 'x', prompt: 'Choose 2 cards to put on top' },
      { op: 'custom', fn: 'shuffleThenPutOnTop', args: { cards: 'x' } },
    ],
  },
  {
    id: 'sv06-158',
    name: 'Lucky Helmet',
    // "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), draw 2 cards."
    triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'draw', n: 2 }] }],
  },

  // ---------------------------------------------------------------- Energy
  {
    id: 'sv06-166',
    name: 'Boomerang Energy',
    // "As long as this card is attached to a Pokémon, it provides {C} Energy.
    //  If this card is discarded by an effect of an attack used by the Pokémon this card is attached to, attach this card from your discard pile to that Pokémon after attacking."
    provides: ['Colorless'],
    reattachAfterOwnAttack: true,
  },
];

void searchToBench;
