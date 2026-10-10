/**
 * Meta card scripts, lane "charizard": the cards of the Mega Charizard X ex / Oricorio ex list
 * (src/__tests__/meta/charizard.ts) that had no script. Written from the printed text in
 * frames-extra/charizard.ts. One scenario test per card in src/__tests__/cards-meta-charizard.test.ts.
 */
import type { CardScript, Filter } from '../../dsl.js';
import { searchToBench, searchToHand } from './helpers.js';
import './meta-charizard-customs.js';

const BASIC_FIRE: Filter = { basicEnergy: true, energyType: 'Fire' };

export const META_CHARIZARD: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'me02-011',
    name: 'Charmander',
    abilities: [
      {
        // "If this Pokémon has no Energy attached, it has no Retreat Cost."
        name: 'Agile',
        statics: [{ effect: { k: 'retreatCost', set: 0 }, scope: 'self', when: { eq: [{ energyOn: 'self' }, 0] } }],
      },
    ],
  },
  {
    id: 'me02-013',
    name: 'Mega Charizard X ex',
    attacks: {
      // "Discard any amount of {R} Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way."
      'Inferno X': {
        pre: [{ op: 'custom', fn: 'charizard.discardEnergyAmong', args: { type: 'Fire', as: 'n' } }],
        damage: { mul: [90, { v: 'n' }] },
      },
    },
  },
  {
    id: 'me02-018',
    name: 'Oricorio ex',
    abilities: [
      {
        // "As often as you like during your turn, if you have any {R} Mega Evolution Pokémon ex in play, you may use this Ability.
        //  Attach a Basic {R} Energy card from your hand to 1 of your Benched {R} Pokémon."
        name: 'Excited Turbo',
        activated: {
          oncePerTurn: false,
          when: {
            and: [
              { gte: [{ pokemon: { zone: 'myPokemon', filter: { type: 'Fire', mega: true, ex: true } } }, 1] },
              { gte: [{ count: { zone: 'hand', filter: BASIC_FIRE } }, 1] },
              { gte: [{ pokemon: { zone: 'myBench', filter: { type: 'Fire' } } }, 1] },
            ],
          },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { cat: 'energy', ...BASIC_FIRE }, min: 1, max: 1, as: 'e' },
            { op: 'chooseSlots', from: 'myBench', filter: { type: 'Fire' }, min: 1, max: 1, as: 't' },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      },
    ],
  },
  {
    id: 'sv08-016',
    name: 'Vulpix',
    // "This Pokémon also does 10 damage to itself."
    attacks: { 'Take Down': { post: [{ op: 'damage', amount: 10, to: 'self' }] } },
  },
  {
    id: 'me04-009',
    name: 'Ninetales',
    attacks: {
      // "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon."
      'Nine-Tailed Transfer': {
        program: [
          { op: 'chooseSlots', from: 'myBench', filter: { damaged: true }, min: 1, max: 1, as: 'from' },
          { op: 'custom', fn: 'charizard.moveAllCounters', args: { from: 'from' } },
        ],
      },
    },
  },
  {
    id: '30th-013',
    name: 'Victini',
    // "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
    attacks: { 'Call for Family': { program: searchToBench({ cat: 'pokemon' }, 2) } },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'me02-087',
    name: 'Dawn',
    // "Search your deck for a Basic Pokémon, a Stage 1 Pokémon, and a Stage 2 Pokémon, reveal them, and put them into
    //  your hand. Then, shuffle your deck."
    play: [
      {
        op: 'chooseCards',
        from: 'deck',
        min: 0,
        max: 3,
        oneEach: [
          { cat: 'pokemon', stage: 'basic' },
          { cat: 'pokemon', stage: 'stage1' },
          { cat: 'pokemon', stage: 'stage2' },
        ],
        reveal: true,
        as: 'found',
      },
      { op: 'move', cards: 'found', to: 'hand' },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'me02-089',
    name: 'Firebreather',
    // "Search your deck for up to 7 Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
    play: searchToHand({ cat: 'energy', ...BASIC_FIRE }, 7, { reveal: true }),
  },
  {
    id: 'sv01-171',
    name: 'Energy Retrieval',
    // "Put up to 2 Basic Energy cards from your discard pile into your hand."
    playable: { gte: [{ count: { zone: 'discard', filter: { cat: 'energy', basicEnergy: true } } }, 1] },
    play: [
      { op: 'chooseCards', from: 'discard', filter: { cat: 'energy', basicEnergy: true }, min: 0, max: 2, as: 'x' },
      { op: 'move', cards: 'x', to: 'hand' },
    ],
  },
  {
    id: 'me02-086',
    name: 'Blowtorch',
    // "You can use this card only if you discard a Basic {R} Energy card from your hand."
    playable: {
      and: [
        { gte: [{ count: { zone: 'hand', filter: { cat: 'energy', ...BASIC_FIRE } } }, 1] },
        {
          or: [
            { gte: [{ pokemon: { zone: 'oppPokemon', filter: { tool: true } } }, 1] },
            { gte: [{ pokemon: { zone: 'oppPokemon', filter: { energy: { basicEnergy: false } } } }, 1] },
            { stadium: true },
          ],
        },
      ],
    },
    play: [
      { op: 'chooseCards', from: 'hand', filter: { cat: 'energy', ...BASIC_FIRE }, min: 1, max: 1, as: 'cost', prompt: 'Discard a Basic {R} Energy card' },
      { op: 'move', cards: 'cost', to: 'discard' },
      // "Discard a Pokémon Tool or Special Energy card from 1 of your opponent's Pokémon, or discard a Stadium in play."
      { op: 'custom', fn: 'charizard.blowtorch' },
    ],
  },
  {
    id: 'me02-085',
    name: 'Battle Cage',
    // "Prevent all damage counters from being placed on Benched Pokémon (both yours and your opponent's) by effects of
    //  attacks and Abilities from the opponent's Pokémon. (Damage from attacks is still taken.)"
    statics: [
      { effect: { k: 'preventCounters', from: ['attack', 'ability'] }, scope: 'myBench' },
      { effect: { k: 'preventCounters', from: ['attack', 'ability'] }, scope: 'oppBench' },
    ],
  },
];
