/**
 * Gauntlet card scripts, lane "metal" (see roadmap/plans/battle-sim/PLAN.md).
 * Written from the printed text in frames.ts. One scenario test per card in
 * src/__tests__/cards-metal.test.ts.
 */
import type { CardScript, Step } from '../../dsl.js';
import { damageOneOf, searchToBench, searchToHand } from './helpers.js';
import './metal-customs.js';

/** "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)." */
const GUARD_30: Step = { op: 'effect', static: { k: 'damageIn', amount: -30 }, on: 'self', duration: 'oppNextTurn' };

const SPECIAL_ENERGY = { basicEnergy: false } as const;
const BASIC_ENERGY = { basicEnergy: true } as const;
const DARK_NOT_PECHARUNT = { type: 'Darkness', not: { name: 'Pecharunt ex' } } as const;

export const METAL: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon (Metal)
  { id: 'me04-060', name: 'Metang', attacks: { 'Guard Press': { post: [GUARD_30] } } },
  {
    id: 'sv10.5b-067',
    name: 'Genesect ex',
    abilities: [
      {
        // "Once during your turn, you may search your deck for up to 2 Evolution {M} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
        name: 'Metallic Signal',
        activated: { program: searchToHand({ cat: 'pokemon', stage: 'evolution', type: 'Metal' }, 2) },
      },
    ],
    attacks: { 'Protect Charge': { post: [GUARD_30] } },
  },
  {
    id: 'me05-065',
    name: 'Mega Excadrill ex',
    attacks: {
      // "Discard the top 2 cards of your opponent's deck."
      Undermine: { post: [{ op: 'move', cards: { top: 2, who: 'opp' }, to: 'discard', who: 'opp' }] },
      // "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 130 more damage."
      // The cost is {M}{M}{M}, so "2 extra" = 5 or more Energy attached.
      'Maximum Drilling': { damage: { add: [200, { cond: { gte: [{ energyOn: 'self' }, 5] }, then: 130, else: 0 }] } },
    },
    notes: 'Maximum Drilling counts Energy units (a 2-unit Special Energy counts 2) against the printed 3-Energy cost.',
  },
  {
    id: 'me03-055',
    name: 'Mega Skarmory ex',
    attacks: {
      // "Shuffle all Energy attached to this Pokémon into your deck, and this attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Sonic Ripper': { program: [{ op: 'custom', fn: 'metal.energyToDeck' }, { op: 'shuffle' }, ...damageOneOf('oppPokemon', 220)] },
    },
  },

  // ---------------------------------------------------------------- Pokémon (Darkness)
  {
    id: 'me02-060',
    name: 'Carvanha',
    // "This Pokémon also does 10 damage to itself."
    attacks: { 'Reckless Charge': { post: [{ op: 'damage', amount: 10, to: 'self' }] } },
  },
  {
    id: 'me02-113',
    name: 'Mega Sharpedo ex',
    attacks: {
      // "Draw 2 cards."
      'Greedy Fang': { post: [{ op: 'draw', n: 2 }] },
      // "If this Pokémon has any damage counters on it, this attack does 150 more damage."
      'Hungry Jaws': { damage: { add: [120, { cond: { gt: [{ countersOn: 'self' }, 0] }, then: 150, else: 0 }] } },
    },
  },
  {
    id: 'sv06.5-039',
    name: 'Pecharunt ex',
    abilities: [
      {
        // "Once during your turn, you may switch 1 of your Benched {D} Pokémon, except any Pecharunt ex, with your Active Pokémon.
        //  If you do, the new Active Pokémon is now Poisoned. You can't use more than 1 Subjugating Chains Ability each turn."
        name: 'Subjugating Chains',
        activated: {
          globalOncePerTurn: true,
          when: { gte: [{ pokemon: { zone: 'myBench', filter: DARK_NOT_PECHARUNT } }, 1] },
          program: [
            { op: 'chooseSlots', from: 'myBench', filter: DARK_NOT_PECHARUNT, min: 1, max: 1, as: 't', prompt: 'Switch which Benched Darkness Pokémon into the Active Spot?' },
            { op: 'switch', who: 'self', with: { v: 't' } },
            { op: 'condition', cond: 'poisoned', to: 'myActive' },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 60 damage for each Prize card your opponent has taken."
      'Irritated Outburst': { damage: { mul: [60, { prizesTaken: 'opp' }] } },
    },
  },
  {
    id: 'mep-078',
    name: 'Toxel',
    // "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
    attacks: { 'Call for Family': { program: searchToBench({}, 2) } },
  },
  {
    id: 'me02-068',
    name: 'Toxtricity',
    abilities: [
      {
        // "Once during your turn, you may use this Ability. Search your deck for a Basic {D} Energy card and attach it to 1 of your Benched {D} Pokémon.
        //  Then, shuffle your deck. If you attached Energy to a Pokémon in this way, place 2 damage counters on that Pokémon."
        name: 'Sinister Surge',
        activated: {
          when: { gte: [{ pokemon: { zone: 'myBench', filter: { type: 'Darkness' } } }, 1] },
          program: [
            { op: 'chooseCards', from: 'deck', filter: { energyType: 'Darkness' }, min: 0, max: 1, as: 'e', prompt: 'Search your deck for a Basic Darkness Energy' },
            {
              op: 'if',
              cond: { gt: [{ len: 'e' }, 0] },
              then: [
                { op: 'chooseSlots', from: 'myBench', filter: { type: 'Darkness' }, min: 1, max: 1, as: 't', prompt: 'Attach it to which Benched Darkness Pokémon?' },
                { op: 'attach', cards: 'e', to: { v: 't' } },
              ],
            },
            { op: 'shuffle' },
            { op: 'if', cond: { gt: [{ len: 'e' }, 0] }, then: [{ op: 'counters', n: 2, to: { v: 't' } }] },
          ],
        },
      },
    ],
  },

  // ---------------------------------------------------------------- Items
  {
    id: 'sv06-148',
    name: 'Enhanced Hammer',
    // "Discard a Special Energy from 1 of your opponent's Pokémon."
    playable: { gte: [{ pokemon: { zone: 'oppPokemon', filter: { energy: SPECIAL_ENERGY } } }, 1] },
    play: [
      { op: 'chooseSlots', from: 'oppPokemon', filter: { energy: SPECIAL_ENERGY }, min: 1, max: 1, as: 't', prompt: 'Discard a Special Energy from which Pokémon?' },
      { op: 'discardEnergy', from: { v: 't' }, count: 1, filter: SPECIAL_ENERGY },
    ],
  },
  {
    id: 'me01-118',
    name: 'Iron Defender',
    // "During your opponent's next turn, all of your {M} Pokémon take 30 less damage from attacks from your opponent's Pokémon
    //  (after applying Weakness and Resistance). (This includes new Pokémon that come into play.)"
    play: [
      {
        op: 'effect',
        static: { k: 'damageIn', amount: -30, fromOpp: true },
        onPlayer: 'self',
        scope: 'myPokemon',
        filter: { type: 'Metal' },
        duration: 'oppNextTurn',
      },
    ],
  },
  {
    id: 'me02-091',
    name: 'Jumbo Ice Cream',
    // "Heal 80 damage from your Active Pokémon that has 3 or more Energy attached."
    playable: { and: [{ gte: [{ energyOn: 'myActive' }, 3] }, { slotIs: { ref: 'myActive', filter: { damaged: true } } }] },
    play: [{ op: 'heal', amount: 80, to: 'myActive' }],
    notes: 'Not offered when the Active Pokémon has no damage (it would do nothing). Energy is counted in units.',
  },
  {
    id: 'sv08-185',
    name: 'Precious Trolley',
    fix: { aceSpec: true },
    // "Search your deck for any number of Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
    playable: { not: { benchFull: 'self' } },
    play: searchToBench({}, 5),
  },
  {
    id: 'me02.5-209',
    name: "Team Rocket's Transceiver",
    // "Search your deck for a Supporter card that has "Team Rocket" in its name, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand({ ttype: 'supporter', nameIncludes: 'Team Rocket' }),
  },
  {
    id: 'me03-108',
    name: 'Energy Recycler',
    // "Shuffle up to 5 Basic Energy cards from your discard pile into your deck."
    playable: { gte: [{ count: { zone: 'discard', filter: BASIC_ENERGY } }, 1] },
    play: [
      { op: 'chooseCards', from: 'discard', filter: BASIC_ENERGY, min: 1, max: 5, as: 'x', prompt: 'Shuffle up to 5 Basic Energy into your deck' },
      { op: 'move', cards: 'x', to: 'deck' },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'me01-115',
    name: 'Energy Switch',
    // "Move a Basic Energy from 1 of your Pokémon to another of your Pokémon."
    playable: {
      and: [
        { gte: [{ pokemon: { zone: 'myPokemon', filter: { energy: BASIC_ENERGY } } }, 1] },
        { gte: [{ pokemon: { zone: 'myPokemon' } }, 2] },
      ],
    },
    play: [
      { op: 'chooseSlots', from: 'myPokemon', filter: { energy: BASIC_ENERGY }, min: 1, max: 1, as: 'src', prompt: 'Move a Basic Energy from which Pokémon?' },
      { op: 'custom', fn: 'metal.moveEnergy', args: { from: 'src', filter: BASIC_ENERGY } },
    ],
  },
  {
    id: 'sv10.5w-085',
    name: 'Tool Scrapper',
    // "Choose up to 2 Pokémon Tools attached to Pokémon (yours or your opponent's) and discard them."
    playable: { gte: [{ pokemon: { zone: 'allPokemon', filter: { tool: true } } }, 1] },
    play: [{ op: 'custom', fn: 'metal.discardTools', args: { max: 2 } }],
  },

  // ---------------------------------------------------------------- Tools and Stadiums
  {
    id: 'sv08.5-095',
    name: 'Binding Mochi',
    // "Attacks used by the Poisoned Pokémon this card is attached to do 40 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
    // damageOut only ever applies to the opponent's Active Pokémon (interp.ts dealDamage).
    statics: [{ effect: { k: 'damageOut', amount: 40 }, scope: 'self', filter: { condition: 'poisoned' } }],
  },
  {
    id: 'sv05-148',
    name: 'Full Metal Lab',
    // "{M} Pokémon (both yours and your opponent's) take 30 less damage from attacks from the opponent's Pokémon (after applying Weakness and Resistance)."
    statics: [{ effect: { k: 'damageIn', amount: -30, fromOpp: true }, scope: 'allPokemon', filter: { type: 'Metal' } }],
  },

  // ---------------------------------------------------------------- Supporters
  {
    id: 'sv10-176',
    name: "Team Rocket's Petrel",
    // "Search your deck for a Trainer card, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand({ cat: 'trainer' }),
  },
  {
    id: 'sv06-145',
    name: 'Carmine',
    // "If you go first, you may use this card during your first turn. Discard your hand and draw 5 cards."
    firstTurnSupporter: true,
    play: [{ op: 'move', cards: { all: 'hand' }, to: 'discard' }, { op: 'draw', n: 5 }],
  },
  {
    id: 'sv06.5-088',
    name: "Janine's Secret Art",
    // "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a Basic {D} Energy card and attach it to that Pokémon.
    //  Then, shuffle your deck. If you attached Energy to your Active Pokémon in this way, it is now Poisoned."
    playable: { gte: [{ pokemon: { zone: 'myPokemon', filter: { type: 'Darkness' } } }, 1] },
    play: [
      { op: 'chooseSlots', from: 'myPokemon', filter: { type: 'Darkness' }, min: 1, max: 2, as: 't', prompt: 'Choose up to 2 of your Darkness Pokémon' },
      { op: 'custom', fn: 'metal.attachFromDeckToEach', args: { slots: 't', filter: { energyType: 'Darkness' }, hit: 'hit' } },
      { op: 'shuffle' },
      { op: 'if', cond: { gt: [{ v: 'activeHit' }, 0] }, then: [{ op: 'condition', cond: 'poisoned', to: 'myActive' }] },
    ],
  },
];
