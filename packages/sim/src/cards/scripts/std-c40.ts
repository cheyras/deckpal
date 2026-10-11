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
];
