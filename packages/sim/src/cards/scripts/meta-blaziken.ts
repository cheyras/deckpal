/**
 * Current-meta card scripts, lane "blaziken" (Dragapult ex / Blaziken ex,
 * src/__tests__/meta/blaziken.ts). Written from the printed text in
 * frames-extra/blaziken.ts; quotes below are that text. One scenario test per
 * card in src/__tests__/cards-meta-blaziken.test.ts.
 */
import type { CardScript } from '../../dsl.js';

const BASIC_ENERGY = { basicEnergy: true } as const;

export const META_BLAZIKEN: CardScript[] = [
  // ---------------------------------------------------------------- Blaziken line
  {
    id: 'sv10-040',
    name: 'Torchic',
    attacks: {
      // "Draw a card."
      Collect: { program: [{ op: 'draw', n: 1 }] },
    },
  },
  {
    id: 'sv10-041',
    name: 'Combusken',
    attacks: {
      // "Flip 2 coins. This attack does 40 damage for each heads."
      'Double Kick': { pre: [{ op: 'flip', n: 2, as: 'h' }], damage: { mul: [40, { v: 'h' }] } },
    },
  },
  {
    id: 'sv09-024',
    name: 'Blaziken ex',
    abilities: [
      {
        // "Once during your turn, you may attach a Basic Energy card from your discard pile to 1 of your Pokémon."
        name: 'Seething Spirit',
        activated: {
          when: { gte: [{ count: { zone: 'discard', filter: BASIC_ENERGY } }, 1] },
          program: [
            { op: 'chooseCards', from: 'discard', filter: BASIC_ENERGY, min: 1, max: 1, as: 'e', prompt: 'Attach which Basic Energy from your discard pile?' },
            { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach it to which of your Pokémon?' },
            { op: 'attach', cards: 'e', to: { v: 't' } },
          ],
        },
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't attack."
      'Smolder-sault': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'me02-087',
    name: 'Dawn',
    // "Search your deck for a Basic Pokémon, a Stage 1 Pokémon, and a Stage 2 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
    play: [
      {
        op: 'chooseCards',
        from: 'deck',
        min: 0,
        max: 3,
        as: 'found',
        reveal: true,
        oneEach: [
          { cat: 'pokemon', stage: 'basic' },
          { cat: 'pokemon', stage: 'stage1' },
          { cat: 'pokemon', stage: 'stage2' },
        ],
      },
      { op: 'move', cards: 'found', to: 'hand' },
      { op: 'shuffle' },
    ],
    notes: 'A search may find fewer than the 3 named cards (the deck is hidden), so min is 0, as for Secret Box.',
  },
];
