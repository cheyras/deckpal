/**
 * Standard batch c40: Scarlet & Violet promos (svp) -- Zarude, Zebstrika, Victini, Tornadus, Gothitelle, Reuniclus. Each script is
 * written from the printed text in frames.ts; quotes below are that text.
 *
 * Rulings consulted: the Compendium entries that name these cards are about other printings' text (Zebstrika's Coordinated Bolt,
 * Sprint and Zap Zone; Victini's Victory Star and Victory Cheer; Tornadus's Push Down and an older Hurricane; Gothitelle's
 * Tractorbeam and Magic Room; Reuniclus's Summoning Gate, Link Fusion and Damage Swap; Zarude V's Jungle Rising), not about the
 * texts scripted here. The two older-Hurricane rulings (#487, #488: with no Benched Pokémon or no Basic Energy attached, that
 * part of the attack is skipped) agree with how this Hurricane resolves and are pinned in the test as that reading.
 */
import type { CardScript, Cond } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './metal-customs.js'; // metal.moveEnergy (Tornadus, Hurricane)
import './std-c33-customs.js'; // c33.evolveChosen (Reuniclus, Cellular Ascension)

const BENCH_COUNT = { pokemon: { zone: 'myBench' as const } };
const SAME_HAND: Cond = { eq: [{ handSize: 'self' }, { handSize: 'opp' }] };

export const STD_C40: CardScript[] = [
  {
    id: 'svp-199',
    name: 'Zarude',
    attacks: {
      // "Search your deck for up to 3 Basic {G} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."
      'Pluck Off': { program: searchToHand({ basicEnergy: true, energyType: 'Grass' }, 3) },
      // "During your next turn, this Pokémon can't attack."
      'Hammer Whip': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'svp-201',
    name: 'Zebstrika',
    attacks: {
      // "Discard your hand and draw 6 cards."
      'Full Speed': {
        program: [
          { op: 'move', cards: { all: 'hand' }, to: 'discard' },
          { op: 'draw', n: 6 },
        ],
      },
    },
  },
  {
    id: 'svp-208',
    name: 'Victini',
    attacks: {
      // "If you have 4 or fewer Benched Pokémon, this attack does nothing."
      'V-Force': {
        program: [
          { op: 'if', cond: { lte: [BENCH_COUNT, 4] }, then: [{ op: 'end' }] },
          { op: 'damage', amount: 120 },
        ],
      },
    },
  },
  {
    id: 'svp-210',
    name: 'Tornadus',
    attacks: {
      // "Attach a Basic Energy card from your hand to this Pokémon."
      'Wrapped in Wind': {
        program: [
          { op: 'chooseCards', from: 'hand', filter: { basicEnergy: true }, min: 1, max: 1, as: 'e', prompt: 'Attach a Basic Energy card from your hand' },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
      },
      // "Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon."
      // With no Benched Pokémon, or no Basic Energy attached, that part of the attack is skipped (Compendium #487, #488, older Hurricane).
      Hurricane: {
        post: [
          { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'src' },
          { op: 'if', cond: { gte: [BENCH_COUNT, 1] }, then: [{ op: 'custom', fn: 'metal.moveEnergy', args: { from: 'src', filter: { basicEnergy: true } } }] },
        ],
      },
    },
  },
  {
    id: 'svp-211',
    name: 'Gothitelle',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is in the Active Spot, you may have your opponent shuffle their hand into their deck and draw 3 cards."
        // Offered only while it does something: a hand to shuffle or a deck to draw from.
        name: 'Distorted Future',
        activated: {
          activeOnly: true,
          when: { or: [{ gte: [{ handSize: 'opp' }, 1] }, { gte: [{ deckSize: 'opp' }, 1] }] },
          program: [
            { op: 'move', cards: { all: 'hand', who: 'opp' }, to: 'deck', who: 'opp' },
            { op: 'shuffle', who: 'opp' },
            { op: 'draw', n: 3, who: 'opp' },
          ],
        },
      },
    ],
    attacks: {
      // "If you have the same number of cards in your hand as your opponent, this attack does 90 more damage."
      'Synchro Shot': { damage: { add: [90, { cond: SAME_HAND, then: 90, else: 0 }] } },
    },
  },
  {
    id: 'svp-212',
    name: 'Reuniclus',
    attacks: {
      // "For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck."
      'Cellular Ascension': {
        program: [
          { op: 'chooseSlots', from: 'myBench', min: BENCH_COUNT, max: BENCH_COUNT, as: 't', prompt: 'Your Benched Pokémon' },
          { op: 'custom', fn: 'c33.evolveChosen', args: { slots: 't' } },
          { op: 'shuffle' },
        ],
      },
      // "This attack does 40 more damage for each of your Evolution Pokémon in play."
      'Evo-Lariat': {
        damage: { add: [40, { mul: [40, { pokemon: { zone: 'myPokemon', filter: { cat: 'pokemon', stage: 'evolution' } } }] }] },
      },
    },
  },
];
