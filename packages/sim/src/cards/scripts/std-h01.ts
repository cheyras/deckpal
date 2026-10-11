/**
 * Standard cheap batch h01 (me01, me02 era Pokémon with simple attack effects).
 * Each script is written from the printed text in frames.ts; quotes below are that text.
 */
import type { CardScript } from '../../dsl.js';
import { searchToBench, searchToHand } from './helpers.js';

export const STD_H01: CardScript[] = [
  {
    id: 'me01-001',
    name: 'Bulbasaur',
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Bind Down': {
        post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }],
      },
    },
  },
  {
    id: 'me01-006',
    name: 'Tangela',
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned."
      'Poison Powder': {
        post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }],
      },
    },
  },
  {
    id: 'me01-007',
    name: 'Tangrowth',
    attacks: {
      // "Heal 30 damage from this Pokémon."
      'Absorb': {
        post: [{ op: 'heal', amount: 30, to: 'self' }],
      },
      // "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 140 more damage."
      'Pumped-Up Whip': {
        damage: {
          add: [
            120,
            { cond: { gte: [{ energyOn: 'self' }, 6] }, then: 140, else: 0 },
          ],
        },
      },
    },
  },
  {
    id: 'me01-009',
    name: 'Bayleef',
    attacks: {
      // "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
      'Push Down': {
        post: [{ op: 'switch', who: 'opp', chooser: 'opp' }],
      },
    },
  },
  {
    id: 'me01-013',
    name: 'Seedot',
    attacks: {
      // "Heal 20 damage from this Pokémon."
      'Nap': {
        post: [{ op: 'heal', amount: 20, to: 'self' }],
      },
    },
  },
  {
    id: 'me01-021',
    name: 'Numel',
    attacks: {
      // "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
      'Call for Family': {
        program: [
          {
            op: 'chooseCards',
            from: 'deck',
            filter: { cat: 'pokemon', stage: 'basic' },
            min: 0,
            max: {
              min: [
                2,
                { sub: [5, { pokemon: { zone: 'myBench' } }] },
              ],
            },
            as: 'found',
          },
          { op: 'move', cards: 'found', to: 'bench' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'me01-027',
    name: 'Raboot',
    attacks: {
      // "This attack does 40 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Jumping Kick': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: 'Choose a Pokémon to damage' },
          { op: 'damage', amount: 40, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: 'me01-032',
    name: 'Mantine',
    attacks: {
      // "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
      'Call for Family': {
        program: [
          {
            op: 'chooseCards',
            from: 'deck',
            filter: { cat: 'pokemon', stage: 'basic' },
            min: 0,
            max: {
              min: [
                2,
                { sub: [5, { pokemon: { zone: 'myBench' } }] },
              ],
            },
            as: 'found',
          },
          { op: 'move', cards: 'found', to: 'bench' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'me01-033',
    name: 'Corphish',
    attacks: {
      // "This Pokémon also does 10 damage to itself."
      'Take Down': {
        post: [{ op: 'damage', amount: 10, to: 'self' }],
      },
    },
  },
  {
    id: 'me01-040',
    name: 'Drizzile',
    attacks: {
      // "Flip 2 coins. This attack does 30 damage for each heads."
      'Double Stab': {
        pre: [{ op: 'flip', n: 2, as: 'h' }],
        damage: { mul: [30, { v: 'h' }] },
      },
    },
  },
  {
    id: 'me01-042',
    name: 'Snom',
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon."
      'Hide': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [
              {
                op: 'effect',
                static: { k: 'preventDamage', andEffects: true },
                on: 'self',
                duration: 'oppNextTurn',
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'me01-044',
    name: 'Eiscue',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Freezing Headbutt': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }],
          },
        ],
      },
    },
  },
  {
    id: 'me01-046',
    name: 'Magneton',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Thunder Shock': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }],
          },
        ],
      },
    },
  },
  {
    id: 'me01-049',
    name: 'Electrike',
    attacks: {
      // "This Pokémon also does 10 damage to itself."
      'Thunder Jolt': {
        post: [{ op: 'damage', amount: 10, to: 'self' }],
      },
    },
  },
  {
    id: 'me01-052',
    name: 'Helioptile',
    attacks: {
      // "Flip 2 coins. This attack does 10 damage for each heads."
      'Double Scratch': {
        pre: [{ op: 'flip', n: 2, as: 'h' }],
        damage: { mul: [10, { v: 'h' }] },
      },
    },
  },
  {
    id: 'me01-053',
    name: 'Heliolisk',
    attacks: {
      // "Your opponent's Active Pokémon is now Confused."
      'Dazzle Blast': {
        post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }],
      },
    },
  },
  {
    id: 'me01-057',
    name: 'Jynx',
    attacks: {
      // "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon."
      'Psychic': {
        damage: {
          add: [
            30,
            { mul: [30, { energyOn: 'oppActive' }] },
          ],
        },
      },
    },
  },
  {
    id: 'me01-058',
    name: 'Ralts',
    attacks: {
      // "Draw a card."
      'Collect': {
        program: [{ op: 'draw', n: 1 }],
      },
    },
  },
  {
    id: 'me01-059',
    name: 'Kirlia',
    attacks: {
      // "Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
      'Call Sign': {
        post: [
          {
            op: 'chooseCards',
            from: 'deck',
            filter: { cat: 'pokemon' },
            min: 0,
            max: 3,
            as: 'found',
            reveal: true,
          },
          { op: 'move', cards: 'found', to: 'hand' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'me01-062',
    name: 'Spoink',
    attacks: {
      // "Flip 3 coins. This attack does 10 damage for each heads."
      'Triple Spin': {
        pre: [{ op: 'flip', n: 3, as: 'h' }],
        damage: { mul: [10, { v: 'h' }] },
      },
    },
  },
  {
    id: 'me01-065',
    name: 'Greavard',
    attacks: {
      // "This Pokémon also does 10 damage to itself."
      'Take Down': {
        post: [{ op: 'damage', amount: 10, to: 'self' }],
      },
    },
  },
  {
    id: 'me01-070',
    name: 'Onix',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
      'Bind': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }],
          },
        ],
      },
    },
  },
  {
    id: 'me01-071',
    name: 'Tyrogue',
    attacks: {
      // "Flip a coin until you get tails. This attack does 30 more damage for each heads."
      'Pow-Pow Punching': {
        pre: [{ op: 'flip', n: 'untilTails', as: 'h' }],
        damage: { add: [10, { mul: [30, { v: 'h' }] }] },
      },
    },
  },
  {
    id: 'me01-079',
    name: 'Toxicroak',
    attacks: {
      // "This Pokémon also does 20 damage to itself."
      'Reckless Charge': {
        post: [{ op: 'damage', amount: 20, to: 'self' }],
      },
    },
  },
  {
    id: 'me01-081',
    name: 'Stonjourner',
    attacks: {
      // "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Stony Kick': {
        post: [
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: 'Choose a Pokémon to damage' },
          { op: 'damage', amount: 20, to: { v: 't' } },
        ],
      },
      // "During your next turn, this Pokémon can't use attacks."
      'Boundless Power': {
        post: [
          {
            op: 'effect',
            static: { k: 'cantAttack' },
            on: 'self',
            duration: 'myNextTurn',
          },
        ],
      },
    },
  },
  {
    id: 'me01-083',
    name: 'Naclstack',
    attacks: {
      // "This attack's damage isn't affected by Resistance."
      'Rock Hurl': {
        ignore: { resistance: true },
      },
    },
  },
  {
    id: 'me01-090',
    name: 'Thievul',
    attacks: {
      // "You may draw cards until you have 6 cards in your hand."
      'Greedy Hunt': {
        post: [
          {
            op: 'if',
            cond: { lt: [{ handSize: 'self' }, 6] },
            then: [
              {
                op: 'may',
                prompt: 'Draw until you have 6 cards in your hand?',
                body: [
                  {
                    op: 'draw',
                    n: { sub: [6, { handSize: 'self' }] },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'me01-091',
    name: 'Shroodle',
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned."
      'Poison Jab': {
        post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }],
      },
    },
  },
  {
    id: 'me01-103',
    name: 'Fearow',
    attacks: {
      // "Flip 5 coins. This attack does 30 damage for each heads."
      'Repeating Drill': {
        pre: [{ op: 'flip', n: 5, as: 'h' }],
        damage: { mul: [30, { v: 'h' }] },
      },
    },
  },
  {
    id: 'me01-109',
    name: 'Yungoos',
    attacks: {
      // "Draw a card."
      'Collect': {
        program: [{ op: 'draw', n: 1 }],
      },
    },
  },
  {
    id: 'me02-006',
    name: 'Lombre',
    attacks: {
      // "Heal 30 damage from this Pokémon."
      'Mega Drain': {
        post: [{ op: 'heal', amount: 30, to: 'self' }],
      },
    },
  },
  {
    id: 'me02-009',
    name: 'Nymble',
    attacks: {
      // "Flip 3 coins. This attack does 10 damage for each heads."
      'Flail Around': {
        pre: [{ op: 'flip', n: 3, as: 'h' }],
        damage: { mul: [10, { v: 'h' }] },
      },
    },
  },
  {
    id: 'me02-017',
    name: 'Reshiram',
    attacks: {
      // "This Pokémon also does 60 damage to itself."
      'Burning Flare': {
        post: [{ op: 'damage', amount: 60, to: 'self' }],
      },
    },
  },
  {
    id: 'me02-021',
    name: 'Seel',
    attacks: {
      // "Heal 20 damage from this Pokémon."
      'Bubble Drain': {
        post: [{ op: 'heal', amount: 20, to: 'self' }],
      },
    },
  },
  {
    id: 'me02-024',
    name: 'Piloswine',
    attacks: {
      // "Flip a coin. If heads, this attack does 30 more damage."
      'Rising Lunge': {
        pre: [{ op: 'flip', n: 1, as: 'h' }],
        damage: {
          add: [
            30,
            { mul: [30, { v: 'h' }] },
          ],
        },
      },
    },
  },
  {
    id: 'me02-030',
    name: 'Yamper',
    attacks: {
      // "Flip a coin. If heads, this attack does 20 more damage."
      'Play Rough': {
        pre: [{ op: 'flip', n: 1, as: 'h' }],
        damage: {
          add: [
            20,
            { mul: [20, { v: 'h' }] },
          ],
        },
      },
    },
  },
  {
    id: 'me02-031',
    name: 'Boltund',
    attacks: {
      // "Flip a coin. If heads, this attack does 70 more damage."
      'Electric Run': {
        pre: [{ op: 'flip', n: 1, as: 'h' }],
        damage: {
          add: [
            70,
            { mul: [70, { v: 'h' }] },
          ],
        },
      },
    },
  },
  {
    id: 'me02-043',
    name: 'Milcery',
    attacks: {
      // "Heal 10 damage from this Pokémon."
      'Draining Kiss': {
        post: [{ op: 'heal', amount: 10, to: 'self' }],
      },
    },
  },
  {
    id: 'me02-049',
    name: 'Gligar',
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned."
      'Poison Jab': {
        post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }],
      },
    },
  },
  {
    id: 'me02-051',
    name: 'Trapinch',
    attacks: {
      // "Flip 2 coins. This attack does 10 damage for each heads."
      'Double Headbutt': {
        pre: [{ op: 'flip', n: 2, as: 'h' }],
        damage: { mul: [10, { v: 'h' }] },
      },
    },
  },
];
