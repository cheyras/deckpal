/**
 * Gauntlet card scripts, lane "misc" (see roadmap/plans/battle-sim/PLAN.md).
 * Written from the printed text in frames.ts. One scenario test per card in
 * src/__tests__/cards-misc.test.ts.
 */
import type { CardScript, Cond, Program } from '../../dsl.js';
import { NO_RULE_BOX, searchToHand } from './helpers.js';
import './misc-customs.js';

/** "You can use this card only when it is the last card in your hand." (checked while it is still in hand) */
const LAST_CARD: Cond = { eq: [{ handSize: 'self' }, 1] };

/** "Each player shuffles their hand into their deck." */
const BOTH_HANDS_INTO_DECKS: Program = [
  { op: 'move', cards: { all: 'hand' }, to: 'deck' },
  { op: 'shuffle' },
  { op: 'move', cards: { all: 'hand', who: 'opp' }, to: 'deck', who: 'opp' },
  { op: 'shuffle', who: 'opp' },
];

export const MISC: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'me01-054',
    name: 'Abra',
    // "Switch this Pokémon with 1 of your Benched Pokémon."
    attacks: { 'Teleportation Attack': { post: [{ op: 'switch', who: 'self' }] } },
  },
  {
    id: 'me01-055',
    name: 'Kadabra',
    abilities: [
      {
        // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Draw 2 cards."
        name: 'Psychic Draw',
        triggers: [{ on: 'evolveFromHand', optional: true, program: [{ op: 'draw', n: 2 }] }],
      },
    ],
  },
  {
    id: 'me01-056',
    name: 'Alakazam',
    abilities: [
      {
        // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Draw 3 cards."
        name: 'Psychic Draw',
        triggers: [{ on: 'evolveFromHand', optional: true, program: [{ op: 'draw', n: 3 }] }],
      },
    ],
    attacks: {
      // "Place 2 damage counters on your opponent's Active Pokémon for each card in your hand."
      'Powerful Hand': { program: [{ op: 'counters', n: { mul: [2, { handSize: 'self' }] }, to: 'oppActive' }] },
    },
  },
  {
    id: 'sv06-053',
    name: 'Froslass',
    abilities: [
      {
        // "During Pokémon Checkup, put 1 damage counter on each Pokémon that has an Ability (both yours and your opponent's), except any Froslass."
        name: 'Freezing Shroud',
        triggers: [{ on: 'checkup', program: [{ op: 'custom', fn: 'freezingShroud' }] }],
      },
    ],
    notes: 'Each Froslass in play puts its own counter (two Froslass = 2 counters per Pokémon). Runs after Special Conditions in Checkup.',
  },
  {
    id: '30th-123',
    name: 'Hisuian Zoroark',
    // TCGdex lists no "evolves from" for this printing; the card evolves from Hisuian Zorua.
    fix: { evolvesFrom: 'Hisuian Zorua' },
    attacks: {
      // "Place damage counters on your opponent's Active Pokémon until its remaining HP is 50."
      'Swirling Resentment': {
        program: [
          { op: 'custom', fn: 'countersUntilHp', args: { hp: 50, as: 'n' } },
          { op: 'counters', n: { v: 'n' }, to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: 'me01-110',
    name: 'Gumshoos',
    abilities: [
      {
        // "Once during your turn, you may use this Ability. Switch a card from your hand with the top card of your deck."
        name: 'Evidence Gathering',
        activated: {
          when: { and: [{ gte: [{ handSize: 'self' }, 1] }, { gte: [{ deckSize: 'self' }, 1] }] },
          program: [
            { op: 'chooseCards', from: 'hand', min: 1, max: 1, as: 'x', prompt: 'Put which card on top of your deck?' },
            { op: 'move', cards: { top: 1 }, to: 'hand' },
            { op: 'move', cards: 'x', to: 'deckTop' },
          ],
        },
      },
    ],
  },
  {
    id: 'me02.5-039',
    name: 'Psyduck',
    abilities: [
      // "Pokémon in play (both yours and your opponent's) lose any Ability that requires the Pokémon using it to Knock Out itself."
      { name: 'Damp', statics: [{ effect: { k: 'loseSelfKoAbilities' }, scope: 'allPokemon' }] },
    ],
    notes: 'A self-KO Ability is recognised by AbilityScript.selfKo or the printed text "this Pokémon is Knocked Out" (Dusclops/Dusknoir Cursed Blast).',
  },
  {
    id: 'me05-070',
    name: 'Silvally',
    abilities: [
      {
        // "Once during your turn, if you have no cards in your hand, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck."
        name: 'Call a Buddy',
        activated: { when: { eq: [{ handSize: 'self' }, 0] }, program: searchToHand({ ttype: 'supporter' }) },
      },
    ],
    attacks: {
      // "Discard an Energy from this Pokémon."
      'Air Slash': { post: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
    },
  },
  {
    id: 'me05-030',
    name: 'Slowbro',
    attacks: {
      // "If you have no cards in your hand, this attack does 160 more damage."
      'All Out': { damage: { add: [50, { cond: { eq: [{ handSize: 'self' }, 0] }, then: 160, else: 0 }] } },
    },
  },
  {
    id: 'me02-041',
    name: 'Mega Diancie ex',
    abilities: [
      // "This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
      { name: 'Diamond Coat', statics: [{ effect: { k: 'damageIn', amount: -30 }, scope: 'self' }] },
    ],
    attacks: {
      // "Discard up to 2 Energy cards from this Pokémon, and this attack does 120 damage for each card you discarded in this way."
      'Garland Ray': {
        pre: [
          {
            op: 'chooseOption',
            options: ['Discard 2 Energy', 'Discard 1 Energy', 'Discard no Energy'],
            as: 'k',
            prompt: 'Garland Ray: discard how many Energy cards?',
          },
          { op: 'if', cond: { lt: [{ v: 'k' }, 2] }, then: [{ op: 'discardEnergy', from: 'self', count: { sub: [2, { v: 'k' }] }, as: 'gone' }] },
        ],
        damage: { mul: [120, { len: 'gone' }] },
      },
    },
  },
  {
    id: 'sv08-072',
    name: 'Togekiss',
    abilities: [
      // "When your opponent's Active Pokémon is Knocked Out, flip a coin. If heads, take 1 more Prize card. The effect of Wonder Kiss doesn't stack."
      { name: 'Wonder Kiss', statics: [{ effect: { k: 'extraPrize', flip: true }, scope: 'me' }] },
    ],
    status: 'needs_ruling',
    notes:
      'Standard reading: any Knock Out of the opposing Active (attack, Checkup, Ability), on either player\'s turn, while Togekiss is in play with its Ability; one flip however many Togekiss. Open: whether a Togekiss Knocked Out at the same time still applies (engine: yes, it is checked before the KO).',
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv10.5w-080',
    name: 'Brave Bangle',
    // "If the Pokémon this card is attached to doesn't have a Rule Box, the attacks it uses do 30 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance)."
    statics: [{ effect: { k: 'damageOut', amount: 30, vs: { ex: true } }, scope: 'self', filter: NO_RULE_BOX }],
  },
  {
    id: 'sv06.5-056',
    name: 'Cassiopeia',
    // "You can use this card only when it is the last card in your hand. Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck."
    playable: LAST_CARD,
    play: searchToHand({}, 2, { reveal: false }),
  },
  {
    id: 'me05-077',
    name: "Gladion's Final Battle",
    // "You can use this card only when it is the last card in your hand. During this turn, attacks used by your Pokémon that don't have a Rule Box do 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
    playable: LAST_CARD,
    play: [
      { op: 'effect', static: { k: 'damageOut', amount: 80 }, onPlayer: 'self', scope: 'myPokemon', filter: NO_RULE_BOX, duration: 'thisTurn' },
    ],
  },
  {
    id: 'sv10-168',
    name: 'Sacred Ash',
    // "Shuffle up to 5 Pokémon from your discard pile into your deck."
    playable: { gte: [{ count: { zone: 'discard', filter: { cat: 'pokemon' } } }, 1] },
    play: [
      { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon' }, min: 1, max: 5, as: 'x', prompt: 'Shuffle up to 5 Pokémon into your deck' },
      { op: 'move', cards: 'x', to: 'deck' },
      { op: 'shuffle' },
    ],
    notes: 'Playable only with a Pokémon in the discard pile (a card with no effect cannot be played); then 1-5 are chosen.',
  },
  {
    id: 'sv10.5w-084',
    name: 'Hilda',
    // "Search your deck for an Evolution Pokémon and an Energy card, reveal them, and put them into your hand. Then, shuffle your deck."
    play: [
      { op: 'chooseCards', from: 'deck', min: 0, max: 2, as: 'found', reveal: true, oneEach: [{ stage: 'evolution' }, { cat: 'energy' }] },
      { op: 'move', cards: 'found', to: 'hand' },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'me03-076',
    name: 'Judge',
    // "Each player shuffles their hand into their deck and draws 4 cards."
    play: [...BOTH_HANDS_INTO_DECKS, { op: 'draw', n: 4 }, { op: 'draw', n: 4, who: 'opp' }],
  },
  {
    id: 'me01-127',
    name: 'Risky Ruins',
    // "Whenever any player puts a Basic non-{D} Pokémon onto their Bench during their turn, place 2 damage counters on that Pokémon."
    triggers: [
      {
        on: 'pokemonBenched',
        when: { slotIs: { ref: 'self', filter: { stage: 'basic', not: { type: 'Darkness' } } } },
        program: [{ op: 'counters', n: 2, to: 'self' }],
      },
    ],
    notes: 'Covers Pokémon benched from hand and by effects (Poffin, Telepathic Psychic Energy); not setup, which is not "during their turn".',
  },
  {
    id: 'sv06-165',
    name: 'Unfair Stamp',
    fix: { aceSpec: true },
    // "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn.
    //  Each player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 2 cards."
    playable: { koLastTurn: 'self' },
    play: [...BOTH_HANDS_INTO_DECKS, { op: 'draw', n: 5 }, { op: 'draw', n: 2, who: 'opp' }],
  },
  {
    id: 'sv10-180',
    name: "Team Rocket's Watchtower",
    // "{C} Pokémon in play (both yours and your opponent's) have no Abilities."
    statics: [{ effect: { k: 'noAbilities' }, scope: 'allPokemon', filter: { type: 'Colorless' } }],
  },
  {
    id: 'me01-122',
    name: 'Mystery Garden',
    // "Once during each player's turn, that player may discard an Energy card from their hand in order to draw cards until they have as many cards in their hand as they have {P} Pokémon in play."
    stadiumAbility: {
      when: { gte: [{ count: { zone: 'hand', filter: { cat: 'energy' } } }, 1] },
      program: [
        { op: 'chooseCards', from: 'hand', filter: { cat: 'energy' }, min: 1, max: 1, as: 'x', prompt: 'Discard an Energy card' },
        { op: 'move', cards: 'x', to: 'discard' },
        { op: 'draw', n: { max: [0, { sub: [{ pokemon: { zone: 'myPokemon', filter: { type: 'Psychic' } } }, { handSize: 'self' }] }] } },
      ],
    },
  },
  {
    id: 'sv06.5-063',
    name: 'Powerglass',
    // "At the end of your turn (after your attack), if the Pokémon this card is attached to is in the Active Spot, you may attach a Basic Energy card from your discard pile to it."
    triggers: [
      {
        on: 'endOfTurn',
        optional: true,
        when: { and: [{ inActive: 'self' }, { gte: [{ count: { zone: 'discard', filter: { basicEnergy: true } } }, 1] }] },
        program: [
          { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: 1, max: 1, as: 'e', prompt: 'Attach a Basic Energy' },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
      },
    ],
  },
  {
    id: 'sv05-157',
    name: 'Prime Catcher',
    fix: { aceSpec: true },
    // "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, switch your Active Pokémon with 1 of your Benched Pokémon."
    playable: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
    play: [
      { op: 'switch', who: 'opp', chooser: 'self' },
      { op: 'switch', who: 'self' },
    ],
  },

  // ---------------------------------------------------------------- Energy
  {
    id: 'sv10.5w-086',
    name: 'Ignition Energy',
    // TCGdex lists this Special Energy as "Normal"; it is a Special Energy.
    fix: { specialEnergy: true },
    // "As long as this card is attached to a Pokémon, it provides {C} Energy. If this card is attached to an Evolution Pokémon, it provides {C}{C}{C} Energy instead."
    provides: ['Colorless'],
    providesIf: { filter: { stage: 'evolution' }, provides: ['Colorless', 'Colorless', 'Colorless'] },
    // "If this card is attached to 1 of your Pokémon, discard it at the end of your turn."
    triggers: [{ on: 'endOfTurn', program: [{ op: 'custom', fn: 'discardThisCard' }] }],
  },
];
