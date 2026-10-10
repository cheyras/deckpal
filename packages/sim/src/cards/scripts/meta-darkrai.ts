/**
 * Current-meta card scripts, lane "darkrai": the cards of the Mega Darkrai ex list
 * (src/__tests__/meta/darkrai.ts) that no other lane scripts. Written from the
 * printed text in frames-extra/darkrai.ts. One scenario test per card in
 * src/__tests__/cards-meta-darkrai.test.ts.
 */
import type { CardScript, Cond, Filter } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './metal-customs.js'; // metal.moveEnergy

/**
 * "affected by a Special Condition": any of the five, as one `slotIs` per condition. (A Filter `any` of
 * `condition` keys does not work on a Pokémon in play: slotMatches hands `any` to defMatches, which has no state.)
 */
const HAS_CONDITION: Cond = {
  or: (['asleep', 'burned', 'confused', 'paralyzed', 'poisoned'] as const).map((condition) => ({ slotIs: { ref: 'oppActive' as const, filter: { condition } } })),
};
const NOT_DARK: Filter = { not: { type: 'Darkness' } };

export const META_DARKRAI: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'me05-048',
    name: 'Mega Darkrai ex',
    attacks: {
      // "If your Benched Pokémon have any damage counters on them, this attack does 110 more damage."
      'Dusk Raid': {
        damage: { add: [110, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { damaged: true } } }, 1] }, then: 110, else: 0 }] },
      },
      // "If your opponent's Active Pokémon is affected by a Special Condition, it is Knocked Out."
      'Abyss Eye': {
        program: [{ op: 'if', cond: HAS_CONDITION, then: [{ op: 'knockOut', target: 'oppActive' }] }],
      },
    },
  },
  {
    id: 'sv09-031',
    name: 'Volcanion ex',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is in the Active Spot, you may make your opponent's Active Pokémon Burned."
        name: 'Scalding Steam',
        activated: { program: [{ op: 'condition', cond: 'burned', to: 'oppActive' }], activeOnly: true },
      },
    ],
    attacks: {
      // "Move an Energy from this Pokémon to 1 of your Benched Pokémon."
      // The attacker is the Active Pokémon, so "another of your Pokémon" (metal.moveEnergy) is a Benched one.
      'Scorching Cyclone': {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'src' },
          { op: 'if', cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] }, then: [{ op: 'custom', fn: 'metal.moveEnergy', args: { from: 'src' } }] },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv08-170',
    name: 'Cyrano',
    // "Search your deck for up to 3 Pokémon ex, reveal them, and put them into your hand. Then, shuffle your deck."
    play: searchToHand({ cat: 'pokemon', ex: true }, 3),
  },
  {
    id: 'me01-121',
    name: 'Mega Signal',
    // "Search your deck for a Mega Evolution Pokémon ex, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand({ cat: 'pokemon', mega: true, ex: true }, 1),
  },
  {
    id: 'me05-075',
    name: 'Dark Bell',
    // "Both Active non-{D} Pokémon are now Confused."
    play: [
      { op: 'if', cond: { slotIs: { ref: 'myActive', filter: NOT_DARK } }, then: [{ op: 'condition', cond: 'confused', to: 'myActive' }] },
      { op: 'if', cond: { slotIs: { ref: 'oppActive', filter: NOT_DARK } }, then: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    ],
  },
  {
    id: 'sv08-180',
    name: 'Lively Stadium',
    // "Each Basic Pokémon in play (both yours and your opponent's) gets +30 HP."
    statics: [{ effect: { k: 'hp', delta: 30 }, scope: 'allPokemon', filter: { stage: 'basic' } }],
  },
  {
    id: 'me02-085',
    name: 'Battle Cage',
    // "Prevent all damage counters from being placed on Benched Pokémon (both yours and your opponent's) by effects of
    // attacks and Abilities from the opponent's Pokémon. (Damage from attacks is still taken.)"
    // Scopes are relative to the Stadium's owner: its Bench and the other player's.
    statics: [
      { effect: { k: 'preventCounters', from: ['attack', 'ability'] }, scope: 'myBench' },
      { effect: { k: 'preventCounters', from: ['attack', 'ability'] }, scope: 'oppBench' },
    ],
  },
];
