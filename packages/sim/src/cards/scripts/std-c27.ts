/**
 * Standard batch c27: Surging Sparks (sv08) cards 156-188. Written from the printed text in frames.ts; quotes below are
 * that text. Tests: src/__tests__/cards-std-c27.test.ts.
 *
 * Skipped (needs vocabulary the engine does not have yet):
 *  - sv08-163 Babiri Berry, sv08-168 Colbur Berry, sv08-184 Passho Berry: "...it takes 60 less damage..., and discard this card."
 *    The only damage trigger (`damagedByAttackActive`) fires when damage actually lands on the Active Pokémon, so a Berry that
 *    reduces the damage to nothing (the usual case) would never be discarded, and a Benched Pokémon that is reduced is never
 *    discarded either. Needs a trigger for "the damage was reduced by this effect".
 *  - sv08-188 Technical Machine: Fluorite: a Tool that grants its holder an attack.
 */
import type { CardScript, Cond, Filter } from '../../dsl.js';
import { damageOneOf, searchToHand } from './helpers.js';
import './std-c03-customs.js'; // c03.ownFirstTurn
import './std-c27-customs.js';
import './std-seed1-customs.js'; // std.discardStadium

/** "You can use this card only if you go second, and only during your first turn." */
const SECOND_FIRST_TURN: Cond = { and: [{ custom: 'c03.ownFirstTurn' }, { not: { firstTurn: true } }] };

const BASIC_ENERGY_TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'] as const;

const MAUSHOLD_NAMES = ['Maushold', 'Maushold ex'];

export const STD_C27: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv08-156',
    name: 'Oranguru',
    attacks: {
      // "Until the end of your next turn, the Defending Pokémon's Weakness is now {C}. (The amount of Weakness doesn't change.)"
      // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2057/): Pokémon with no printed Weakness gain x2 Colorless Weakness from this attack.
      // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2056/): Weakness is only to Colorless-type Pokémon, not all types.
      "Now You're in My Power": {
        post: [{ op: 'effect', static: { k: 'weaknessType', type: 'Colorless' }, on: 'defender', duration: 'myNextTurn' }],
      },
    },
    notes: 'Weakness x2 is applied to a Defending Pokémon with no printed Weakness too (ruling 2057), which the weaknessType static does.',
  },
  {
    id: 'sv08-158',
    name: 'Maushold',
    attacks: {
      // "Search your deck for up to 2 in any combination of Maushold and Maushold ex and put them onto your Bench. Then, shuffle your deck."
      'Familial March': { program: [{ op: 'custom', fn: 'c27.searchToBench', args: { names: MAUSHOLD_NAMES, max: 2 } }] },
      // "Flip 4 coins. This attack does 30 damage for each heads."
      'Incessant Incisors': { pre: [{ op: 'flip', n: 4, as: 'h' }], damage: { mul: [30, { v: 'h' }] } },
    },
  },
  {
    id: 'sv08-159',
    name: 'Cyclizar ex',
    attacks: {
      // "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Break Through': { post: damageOneOf('oppBench', 30) },
      // "You may draw 5 cards."
      'Zircon Road': { post: [{ op: 'may', body: [{ op: 'draw', n: 5 }] }] },
    },
  },
  {
    id: 'sv08-160',
    name: 'Flamigo ex',
    attacks: {
      // "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage."
      'Precise Beak': {
        damage: { add: [30, { cond: { eq: [{ energyOn: 'self' }, { energyOn: 'oppActive' }] }, then: 100, else: 0 }] },
      },
      // "This Pokémon also does 30 damage to itself."
      'Brave Bird': { post: [{ op: 'damage', amount: 30, to: 'self' }] },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv08-162',
    name: 'Amulet of Hope',
    // "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck."
    // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2061/): Amulet of Hope requires taking at least one card; "up to 3" means 1 to 3.
    triggers: [
      {
        on: 'knockedOutByAttack',
        program: [
          { op: 'chooseCards', from: 'deck', min: 1, max: 3, as: 'found' },
          { op: 'move', cards: 'found', to: 'hand' },
          { op: 'shuffle' },
        ],
      },
    ],
  },
  {
    id: 'sv08-164',
    name: 'Brilliant Blender',
    // "Search your deck for up to 5 cards and discard them. Then, shuffle your deck."
    // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2062/): Brilliant Blender requires discarding at least one card from your deck.
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [
      { op: 'chooseCards', from: 'deck', min: 1, max: 5, as: 'found' },
      { op: 'move', cards: 'found', to: 'discard' },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'sv08-165',
    name: 'Call Bell',
    // "You can use this card only if you go second, and only during your first turn."
    playable: { and: [SECOND_FIRST_TURN, { gte: [{ deckSize: 'self' }, 1] }] },
    // "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand({ ttype: 'supporter' }, 1),
  },
  {
    id: 'sv08-166',
    name: 'Chill Teaser Toy',
    // "You can use this card only if you go second, and only during your first turn."
    playable: {
      and: [SECOND_FIRST_TURN, { gte: [{ pokemon: { zone: 'oppPokemon', filter: { energized: true } } }, 1] }],
    },
    // "Put an Energy attached to 1 of your opponent's Pokémon into their hand."
    play: [
      { op: 'chooseSlots', from: 'oppPokemon', filter: { energized: true }, min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Pokémon with Energy attached" },
      { op: 'custom', fn: 'c27.slotEnergyToHand', args: { slot: 't' } },
    ],
  },
  {
    id: 'sv08-167',
    name: "Clemont's Quick Wit",
    // "Heal 60 damage from each of your {L} Pokémon."
    playable: { gte: [{ pokemon: { zone: 'myPokemon', filter: { type: 'Lightning', damaged: true } } }, 1] },
    play: [{ op: 'custom', fn: 'c27.healEach', args: { amount: 60, zone: 'myPokemon', filter: { type: 'Lightning' } } }],
  },
  {
    id: 'sv08-171',
    name: 'Deduction Kit',
    // "Look at the top 3 cards of your deck and put them back in any order, or shuffle them and put them on the bottom of your deck."
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [
      { op: 'chooseOption', options: ['Put them back in any order', 'Shuffle them and put them on the bottom of your deck'], as: 'o', prompt: 'Look at the top 3 cards of your deck' },
      {
        op: 'if',
        cond: { eq: [{ v: 'o' }, 0] },
        then: [
          { op: 'move', cards: { top: 3 }, to: 'deckTop', as: 'x' },
          { op: 'putOnTop', cards: 'x' },
        ],
        else: [{ op: 'custom', fn: 'c27.topToBottomShuffled', args: { n: 3 } }],
      },
    ],
  },
  {
    id: 'sv08-172',
    name: 'Dragon Elixir',
    // "Heal 60 damage from your Active {N} Pokémon."
    playable: { slotIs: { ref: 'myActive', filter: { type: 'Dragon', damaged: true } } },
    play: [{ op: 'heal', amount: 60, to: 'myActive' }],
  },
  {
    id: 'sv08-173',
    name: 'Drasna',
    // "Shuffle your hand into your deck. Then, flip a coin. If heads, draw 8 cards. If tails, draw 3 cards."
    play: [
      { op: 'move', cards: { all: 'hand' }, to: 'deck' },
      { op: 'shuffle' },
      { op: 'flip', n: 1, as: 'h' },
      { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'draw', n: 8 }], else: [{ op: 'draw', n: 3 }] },
    ],
  },
  {
    id: 'sv08-174',
    name: 'Drayton',
    // "Look at the top 7 cards of your deck. You may reveal a Pokémon and a Trainer card you find there and put them into your hand. Shuffle the other cards back into your deck."
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [{ op: 'custom', fn: 'c27.lookDeckPick', args: { from: 'top', n: 7, picks: [{ cat: 'pokemon' }, { cat: 'trainer' }] } }],
  },
  {
    id: 'sv08-175',
    name: 'Dusk Ball',
    // "Look at the bottom 7 cards of your deck. You may reveal a Pokémon you find there and put it into your hand. Shuffle the other cards back into your deck."
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [{ op: 'custom', fn: 'c27.lookDeckPick', args: { from: 'bottom', n: 7, picks: [{ cat: 'pokemon' }] } }],
  },
  {
    id: 'sv08-176',
    name: 'Energy Search Pro',
    // "Search your deck for any number of Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."
    // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2063/): only one card of each Energy type goes into your hand.
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [
      {
        op: 'chooseCards',
        from: 'deck',
        min: 0,
        max: BASIC_ENERGY_TYPES.length,
        as: 'found',
        reveal: true,
        oneEach: BASIC_ENERGY_TYPES.map((t): Filter => ({ energyType: t })),
      },
      { op: 'move', cards: 'found', to: 'hand' },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'sv08-178',
    name: "Jasmine's Gaze",
    // "During your opponent's next turn, all of your Pokémon take 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). (This includes new Pokémon that come into play.)"
    play: [
      { op: 'effect', static: { k: 'damageIn', amount: -30, fromOpp: true }, onPlayer: 'self', scope: 'myPokemon', duration: 'oppNextTurn' },
    ],
  },
  {
    id: 'sv08-179',
    name: "Lisia's Appeal",
    // "Switch in 1 of your opponent's Benched Basic Pokémon to the Active Spot. If you do, the new Active Pokémon is now Confused."
    playable: { gte: [{ pokemon: { zone: 'oppBench', filter: { stage: 'basic' } } }, 1] },
    play: [
      { op: 'chooseSlots', from: 'oppBench', filter: { stage: 'basic' }, min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Benched Basic Pokémon" },
      { op: 'switch', who: 'opp', chooser: 'self', with: { v: 't' } },
      { op: 'condition', cond: 'confused', to: { v: 't' } },
    ],
  },
  {
    id: 'sv08-181',
    name: 'Meddling Memo',
    // "Your opponent counts the cards in their hand, shuffles those cards, and puts them on the bottom of their deck. If they do, they draw that many cards."
    // A Trainer that would do nothing can't be played (an empty opposing hand).
    playable: { gte: [{ handSize: 'opp' }, 1] },
    play: [
      { op: 'custom', fn: 'shuffleHandToBottom', args: { who: 'opp' } },
      { op: 'draw', n: { v: 'moved' }, who: 'opp' },
    ],
  },
  {
    id: 'sv08-182',
    name: 'Megaton Blower',
    // "Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon, and discard a Stadium in play."
    // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2065/): yes, playable with only a Stadium in play: discarding it does not depend on discarding Tools or Special Energy.
    // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2064/): it cannot be played for no effect; if at least one Stadium, Tool or Special Energy is in play, do as much as you can.
    playable: {
      or: [
        { stadium: true },
        { gte: [{ pokemon: { zone: 'oppPokemon', filter: { tool: true } } }, 1] },
        { gte: [{ pokemon: { zone: 'oppPokemon', filter: { energy: { basicEnergy: false } } } }, 1] },
      ],
    },
    play: [
      { op: 'custom', fn: 'c27.discardOppToolsAndSpecialEnergy' },
      { op: 'custom', fn: 'std.discardStadium' },
    ],
  },
  {
    id: 'sv08-183',
    name: 'Miracle Headset',
    // "Put up to 2 Supporter cards from your discard pile into your hand."
    // "Up to 2" on a Trainer is 1 to 2 (TPCi 2026-02-19), so it needs a Supporter in the discard pile.
    playable: { gte: [{ count: { zone: 'discard', filter: { ttype: 'supporter' } } }, 1] },
    play: [
      { op: 'chooseCards', from: 'discard', filter: { ttype: 'supporter' }, min: 1, max: 2, as: 'x' },
      { op: 'move', cards: 'x', to: 'hand' },
    ],
  },
  {
    id: 'sv08-186',
    name: 'Scramble Switch',
    // "Switch your Active Pokémon with 1 of your Benched Pokémon. If you do, you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon."
    // Ruling (TPCi Rules Team 2013-02-07, https://compendium.pokegym.net/ruling/34/): Block only stops Retreating, so Scramble Switch can still switch your Active Pokémon. (This is a Trainer's switch, not a retreat.)
    playable: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
    play: [
      { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'old' },
      { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Choose a Benched Pokémon to switch in' },
      { op: 'switch', who: 'self', with: { v: 't' } },
      {
        op: 'if',
        cond: { gt: [{ energyOn: { v: 'old' } }, 0] },
        then: [{ op: 'may', body: [{ op: 'custom', fn: 'c27.moveEnergyBetween', args: { from: 'old', to: 't' } }] }],
      },
    ],
  },
];
