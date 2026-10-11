/**
 * Standard batch c39: Scarlet & Violet Black Star Promos (svp) whose printed text no script covered. (The promos whose text matches another printing
 * share that printing's script, now that the frames carry its Weakness/Resistance -- see printed-wr.ts.) Each script is written from the printed text in frames; quotes below are that text.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - svp-173 Eevee: Boosted Evolution ("As long as this Pokémon is in the Active Spot, it can evolve during your first turn or
 *    the turn you play it") needs a static that changes evolution timing; no StaticEffect lifts the evolve restrictions.
 *  - svp-174 Eevee ex: Rainbow DNA ("can evolve into any Pokémon ex that evolves from Eevee") needs a static that changes what
 *    a Pokémon may evolve into; the engine only evolves a card whose "evolves from" names the Pokémon.
 */
import type { CardScript, Filter, Program } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './std-c06-customs.js'; // c06.attachSplit
import './std-seed1-customs.js'; // std.revealHand

const BASIC_L: Filter = { cat: 'energy', energyType: 'Lightning' };

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

export const STD_C39: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'svp-155',
    name: 'Wooper',
    attacks: {
      // "Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck."
      'Scoop Water': {
        post: [
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Water' }, min: 0, max: 3, as: 'e', prompt: 'Choose up to 3 Basic {W} Energy cards' },
          { op: 'move', cards: 'e', to: 'deck' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'svp-156',
    name: 'Quagsire',
    attacks: {
      // "Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way."
      'Drenched Headbutt': {
        pre: [
          { op: 'look', n: 3, filter: { cat: 'energy' }, as: 'en' },
          { op: 'move', cards: { top: 3 }, to: 'discard' },
        ],
        damage: { mul: [80, { len: 'en' }] },
      },
    },
  },
  {
    id: 'svp-157',
    name: 'Zapdos',
    attacks: {
      // "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon."
      'Follow-Up Bolt': { damage: { add: [20, { mul: [10, { countersOn: 'defender' }] }] } },
    },
  },
  {
    id: 'svp-158',
    name: 'Pachirisu',
    attacks: {
      // "Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."
      'Crackling Charge': {
        post: [
          { op: 'flip', n: 3, as: 'h' },
          {
            op: 'if',
            cond: { and: [{ gte: [{ v: 'h' }, 1] }, { gte: [{ pokemon: { zone: 'myBench' } }, 1] }] },
            then: [
              { op: 'chooseCards', from: 'discard', filter: BASIC_L, min: 0, max: { v: 'h' }, as: 'e', prompt: 'Choose Basic {L} Energy cards (up to the number of heads)' },
              { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myBench' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'svp-162',
    name: 'Houndstone ex',
    attacks: {
      // "Flip a coin until you get tails. This attack does 20 more damage for each heads."
      'Horrifying Fang': {
        pre: [{ op: 'flip', n: 'untilTails', as: 'h' }],
        damage: { add: [100, { mul: [20, { v: 'h' }] }] },
      },
    },
  },
  {
    id: 'svp-178',
    name: 'Kyogre ex',
    attacks: {
      // "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
      'Winding Waves': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
            then: [{ op: 'may', body: [{ op: 'switch', who: 'opp', chooser: 'opp' }] }],
          },
        ],
      },
      // "Discard 2 Energy from this Pokémon."
      'Tidal Surge': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'svp-179',
    name: 'Xerneas ex',
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 100 more damage."
      'Rising Horns': { damage: { add: [120, { cond: { slotIs: { ref: 'defender', filter: { ex: true } } }, then: 100, else: 0 }] } },
    },
  },
  {
    id: 'svp-180',
    name: 'Dialga ex',
    attacks: {
      // "Draw a card."
      'Time Bellow': { post: [{ op: 'draw', n: 1 }] },
      // "This attack does 20 more damage for each {M} Energy attached to this Pokémon."
      'Metal Blast': { damage: { add: [100, { mul: [20, { energyOn: 'self', type: 'Metal' }] }] } },
    },
  },
  {
    id: 'svp-185',
    name: 'Yanma',
    attacks: {
      // "Your opponent reveals their hand."
      'Silent Wing': { post: [{ op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } }] },
    },
  },
  {
    id: 'svp-188',
    name: 'Scrafty',
    attacks: {
      // "Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck."
      "Nab 'n' Dash": { post: searchToHand({}, { pokemon: { zone: 'myBench' } }, { reveal: false }) },
    },
  },
  {
    id: 'svp-197',
    name: 'Koraidon ex',
    attacks: {
      // "If your Benched Pokémon have any damage counters on them, this attack does 120 more damage."
      'Revenge Buster': {
        damage: { add: [100, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { damaged: true } } }, 1] }, then: 120, else: 0 }] },
      },
    },
  },
  {
    id: 'svp-198',
    name: 'Zacian ex',
    attacks: {
      // "Search your deck for a Basic {M} Energy card and attach it to this Pokémon. Then, shuffle your deck."
      'Steel Armament': {
        post: [
          { op: 'chooseCards', from: 'deck', filter: { energyType: 'Metal' }, min: 0, max: 1, as: 'e', prompt: 'Choose a Basic {M} Energy card' },
          { op: 'if', cond: { gte: [{ len: 'e' }, 1] }, then: [{ op: 'attach', cards: 'e', to: 'self' }] },
          { op: 'shuffle' },
        ],
      },
      // "During your next turn, this Pokémon can't use Slashing Strike."
      'Slashing Strike': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Slashing Strike' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
];
