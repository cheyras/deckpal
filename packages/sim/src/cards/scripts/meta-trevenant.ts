/**
 * Meta card scripts, lane "trevenant": Hop's Trevenant / Hop's Snorlax (src/__tests__/meta/trevenant.ts).
 * Written from the printed text in frames-extra/trevenant.ts; quotes below are that text. One scenario
 * test per card in src/__tests__/cards-meta-trevenant.test.ts.
 */
import type { CardScript, Filter } from '../../dsl.js';
import './meta-trevenant-customs.js';
import { searchToBench } from './helpers.js';

/** "Hop's Pokémon": a Pokémon whose name contains "Hop's". */
const HOPS: Filter = { cat: 'pokemon', nameIncludes: "Hop's" };

export const META_TREVENANT: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'me02.5-095',
    name: "Hop's Phantump",
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon."
      'Splashing Dodge': {
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
    id: 'me02.5-096',
    name: "Hop's Trevenant",
    attacks: {
      // "If any of your Hop's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage."
      'Horrifying Revenge': {
        damage: { add: [30, { cond: { custom: 'trevenant.hopsKoByAttackLastTurn' }, then: 100, else: 0 }] },
      },
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      Corner: { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv09-117',
    name: "Hop's Snorlax",
    abilities: [
      {
        // "Attacks used by your Hop's Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). The effect of Extra Helpings doesn't stack."
        name: 'Extra Helpings',
        statics: [{ effect: { k: 'damageOut', amount: 30, noStack: 'Extra Helpings' }, scope: 'myPokemon', filter: HOPS }],
      },
    ],
    attacks: {
      // "This Pokémon also does 80 damage to itself."
      'Dynamic Press': { post: [{ op: 'damage', amount: 80, to: 'self' }] },
    },
  },
  {
    id: 'sv09-136',
    name: "Hop's Dubwool",
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may switch in 1 of your opponent's Benched Pokémon to the Active Spot."
        name: 'Defiant Horn',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            when: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
            program: [{ op: 'switch', who: 'opp', chooser: 'self' }],
          },
        ],
      },
    ],
  },
  {
    id: 'sv09-138',
    name: "Hop's Cramorant",
    attacks: {
      // "If your opponent doesn't have exactly 3 or 4 Prize cards remaining, this attack does nothing."
      // Base 0 does no damage at all: modifiers (Hop's Choice Band, Postwick) apply only to damage above 0 (interp.ts).
      'Fickle Spitting': {
        damage: { cond: { or: [{ lt: [{ prizesLeft: 'opp' }, 3] }, { gt: [{ prizesLeft: 'opp' }, 4] }] }, then: 0, else: 120 },
      },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv06-151',
    name: 'Hassel',
    // "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn."
    playable: { koLastTurn: 'self' },
    // "Look at the top 8 cards of your deck and put up to 3 of them into your hand. Shuffle the other cards back into your deck."
    play: [{ op: 'custom', fn: 'lookAtTopTake', args: { n: 8, max: 3 } }],
  },
  {
    id: 'sv09-147',
    name: "Hop's Bag",
    // "Search your deck for up to 2 Basic Hop's Pokémon and put them onto your Bench. Then, shuffle your deck."
    play: searchToBench(HOPS, 2),
  },
  {
    id: 'sv09-148',
    name: "Hop's Choice Band",
    // "Attacks used by the Hop's Pokémon this card is attached to cost {C} less and do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
    statics: [
      { effect: { k: 'attackCostC', delta: -1 }, scope: 'self', filter: HOPS },
      { effect: { k: 'damageOut', amount: 30 }, scope: 'self', filter: HOPS },
    ],
  },
  {
    id: 'sv09-154',
    name: 'Postwick',
    // "Attacks used by Hop's Pokémon (both yours and your opponent's) do 30 more damage to the opponent's Active Pokémon (before applying Weakness and Resistance)."
    statics: [{ effect: { k: 'damageOut', amount: 30 }, scope: 'allPokemon', filter: HOPS }],
  },
  {
    id: 'sv09-157',
    name: 'Ruffian',
    playable: { gte: [{ pokemon: { zone: 'oppPokemon', filter: { any: [{ tool: true }, { energy: { basicEnergy: false } }] } } }, 1] },
    // "Discard a Pokémon Tool and a Special Energy from 1 of your opponent's Pokémon."
    play: [
      {
        op: 'chooseSlots',
        from: 'oppPokemon',
        filter: { any: [{ tool: true }, { energy: { basicEnergy: false } }] },
        min: 1,
        max: 1,
        as: 't',
        prompt: "Discard a Pokémon Tool and a Special Energy from which of your opponent's Pokémon?",
      },
      { op: 'custom', fn: 'trevenant.discardToolFrom', args: { slot: 't' } },
      { op: 'discardEnergy', from: { v: 't' }, count: 1, filter: { basicEnergy: false } },
    ],
    notes: 'Either part may find nothing to discard (a Pokémon with only a Tool, or only a Special Energy); the rest still happens.',
  },

  // ---------------------------------------------------------------- Energy
  {
    id: 'sv05-161',
    name: 'Mist Energy',
    // "As long as this card is attached to a Pokémon, it provides {C} Energy.
    //  Prevent all effects of attacks used by your opponent's Pokémon done to the Pokémon this card is attached to. (Existing effects are not removed. Damage is not an effect.)"
    provides: ['Colorless'],
    statics: [{ effect: { k: 'preventEffects', from: ['attack'] }, scope: 'self' }],
  },
];
