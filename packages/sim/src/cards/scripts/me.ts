/**
 * Mega Evolution era (me01 Mega Evolution … me05 Pitch Black, me02.5 Ascended Heroes).
 * Each script is written from the printed text in frames.ts; quotes below are that text.
 */
import type { CardScript } from '../../dsl.js';
import { BENCH_SPACE, HIDE_N_SNEAK, NO_RULE_BOX, damageOneOf, discardOthers, inDiscard, searchToBench, searchToHand } from './helpers.js';

const HNS_POKEMON = { cat: 'pokemon', hasAbility: "Hide 'n' Sneak" } as const;

export const ME: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  { id: 'me05-033', name: 'Shuppet', abilities: [HIDE_N_SNEAK] },
  {
    id: 'me05-034',
    name: 'Banette',
    abilities: [HIDE_N_SNEAK],
    attacks: {
      // "You may search your deck for a card and put it into your hand. Then, shuffle your deck."
      'Puppet Pull': { post: [{ op: 'may', prompt: 'Search your deck for a card?', body: searchToHand({}, 1, { reveal: false }) }] },
    },
  },
  {
    id: 'me05-039',
    name: 'Dhelmise',
    attacks: {
      // "If you have 4 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, this attack does 140 more damage."
      'Vengeful Anchor': {
        damage: { add: [30, { cond: { gte: [inDiscard(HNS_POKEMON), 4] }, then: 140, else: 0 }] },
      },
    },
  },
  {
    id: 'me05-005',
    name: 'Poltchageist',
    abilities: [HIDE_N_SNEAK],
    attacks: { 'Furtive Drop': { program: [{ op: 'counters', n: 1, to: 'oppActive' }] } },
  },
  {
    id: 'me05-006',
    name: 'Sinistcha',
    abilities: [HIDE_N_SNEAK],
    attacks: {
      // "If you have 6 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, place 4 damage counters on each of your opponent's Pokémon."
      'Matcha Spin': {
        program: [{ op: 'if', cond: { gte: [inDiscard(HNS_POKEMON), 6] }, then: [{ op: 'counters', n: 4, to: { each: 'oppPokemon' } }] }],
      },
    },
  },
  {
    id: 'me05-029',
    name: 'Slowpoke',
    attacks: {
      // "You may discard any number of cards from your hand."
      'All-You-Can-Yeet': {
        program: [
          { op: 'chooseCards', from: 'hand', min: 0, max: { handSize: 'self' }, as: 'x', prompt: 'Discard any number of cards' },
          { op: 'move', cards: 'x', to: 'discard' },
        ],
      },
    },
  },
  {
    id: 'me04-061',
    name: 'Metagross',
    attacks: {
      // "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)"
      'Bounce Back': { post: [{ op: 'switch', who: 'opp', chooser: 'opp' }] },
      // "You may discard 3 {M} Energy from this Pokémon and have this attack do 150 more damage."
      // Ruling (Compendium #2352; Japanese Q&A): the bonus applies even with fewer than 3 to discard —
      // you discard as many as you can. So a Seek Inspiration copy with no Metal still does 300.
      'Metallic Hammer': {
        pre: [
          { op: 'set', v: 'bonus', value: 0 },
          {
            op: 'may',
            prompt: 'Discard 3 Metal Energy for +150 damage?',
            body: [
              { op: 'discardEnergy', from: 'self', count: 3, filter: { energyType: 'Metal' } },
              { op: 'set', v: 'bonus', value: 150 },
            ],
          },
        ],
        damage: { add: [150, { v: 'bonus' }] },
      },
    },
    notes: 'Metallic Hammer: ruling cited in the owner\'s Toolbox Slowking strategy guide (compendium.pokegym.net/ruling/2352).',
  },
  {
    id: 'me04-070',
    name: 'Patrat',
    abilities: [
      // "Damage counters on each Pokémon (both yours and your opponent's) can't be moved to other Pokémon."
      { name: 'Watchful Eye', statics: [{ effect: { k: 'countersFixed' }, scope: 'both' }] },
    ],
  },
  {
    id: 'me01-104',
    name: 'Mega Kangaskhan ex',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Draw 2 cards. You can't use more than 1 Run Errand Ability each turn."
        name: 'Run Errand',
        activated: { program: [{ op: 'draw', n: 2 }], activeOnly: true, globalOncePerTurn: true },
      },
    ],
    attacks: {
      // "Flip a coin until you get tails. This attack does 50 more damage for each heads."
      'Rapid-Fire Combo': {
        pre: [{ op: 'flip', n: 'untilTails', as: 'h' }],
        damage: { add: [200, { mul: [50, { v: 'h' }] }] },
      },
    },
  },
  {
    id: 'me03-062',
    name: 'Meowth ex',
    abilities: [
      {
        // "Once during your turn, when you play this Pokémon from your hand onto your Bench, you may use this Ability.
        //  Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.
        //  You can't use more than 1 Ability that has "Last-Ditch" in its name each turn."
        name: 'Last-Ditch Catch',
        triggers: [
          {
            on: 'playToBench',
            optional: true,
            program: [
              { op: 'custom', fn: 'oncePerTurnByName', args: { name: 'Last-Ditch' } },
              ...searchToHand({ ttype: 'supporter' }),
            ],
          },
        ],
      },
    ],
    attacks: {
      // "Put this Pokémon and all attached cards into your hand."
      'Tuck Tail': { post: [{ op: 'custom', fn: 'returnSelfToHand' }] },
    },
  },
  {
    id: 'me02.5-076',
    name: "Lillie's Clefairy ex",
    abilities: [
      {
        // "The Weakness of each of your opponent's {N} Pokémon in play is now {P}. (Apply Weakness as ×2.)"
        name: 'Fairy Zone',
        statics: [{ effect: { k: 'weaknessType', type: 'Psychic' }, scope: 'oppPokemon', filter: { type: 'Dragon' } }],
      },
    ],
    attacks: {
      // "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's)."
      'Full Moon Rondo': {
        damage: { add: [20, { mul: [20, { add: [{ pokemon: { zone: 'myBench' } }, { pokemon: { zone: 'oppBench' } }] }] }] },
      },
    },
  },
  {
    id: 'me02.5-098',
    name: 'Spectrier',
    attacks: {
      // "Discard all Energy from this Pokémon and place 12 damage counters on 1 of your opponent's Pokémon."
      'Phantasmal Barrage': {
        program: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' },
          { op: 'counters', n: 12, to: { v: 't' } },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'me01-131',
    name: 'Ultra Ball',
    playable: { gte: [{ handSize: 'self' }, 3] },
    play: [...discardOthers(2), ...searchToHand({ cat: 'pokemon' })],
  },
  {
    id: 'me01-114',
    name: "Boss's Orders",
    playable: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
    // "Switch in 1 of your opponent's Benched Pokémon to the Active Spot."
    play: [{ op: 'switch', who: 'opp', chooser: 'self' }],
  },
  {
    id: 'me01-119',
    name: "Lillie's Determination",
    // "Shuffle your hand into your deck. Then, draw 6 cards. If you have exactly 6 Prize cards remaining, draw 8 cards instead."
    play: [
      { op: 'move', cards: { all: 'hand' }, to: 'deck' },
      { op: 'shuffle' },
      { op: 'draw', n: { cond: { eq: [{ prizesLeft: 'self' }, 6] }, then: 8, else: 6 } },
    ],
  },
  {
    id: 'me01-130',
    name: 'Switch',
    playable: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
    play: [{ op: 'switch', who: 'self' }],
  },
  {
    id: 'me03-081',
    name: 'Poké Pad',
    // "Search your deck for a Pokémon that doesn't have a Rule Box, reveal it, and put it into your hand. Then, shuffle your deck."
    play: searchToHand(NO_RULE_BOX),
  },
  {
    id: 'me04-080',
    name: 'Prism Tower',
    // "Once during each player's turn, that player may discard 2 cards from their hand in order to draw a card."
    stadiumAbility: {
      when: { gte: [{ handSize: 'self' }, 2] },
      program: [
        { op: 'chooseCards', from: 'hand', min: 2, max: 2, as: 'x', prompt: 'Discard 2 cards' },
        { op: 'move', cards: 'x', to: 'discard' },
        { op: 'draw', n: 1 },
      ],
    },
  },
  {
    id: 'me04-082',
    name: 'Special Red Card',
    // "You can use this card only if your opponent has 3 or fewer Prize cards remaining.
    //  Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 3 cards."
    playable: { lte: [{ prizesLeft: 'opp' }, 3] },
    play: [
      { op: 'custom', fn: 'shuffleHandToBottom', args: { who: 'opp' } },
      { op: 'if', cond: { gt: [{ v: 'moved' }, 0] }, then: [{ op: 'draw', n: 3, who: 'opp' }] },
    ],
  },
  {
    id: 'me05-078',
    name: 'Gwynn',
    // "Discard up to 2 Pokémon that don't have a Rule Box from your hand, and draw 3 cards for each card you discarded in this way."
    play: [
      { op: 'chooseCards', from: 'hand', filter: NO_RULE_BOX, min: 0, max: 2, as: 'x', prompt: 'Discard up to 2 Pokémon without a Rule Box' },
      { op: 'move', cards: 'x', to: 'discard' },
      { op: 'draw', n: { mul: [3, { len: 'x' }] } },
    ],
  },
  {
    id: 'me02-094',
    name: 'Wondrous Patch',
    // "Attach a Basic {P} Energy card from your discard pile to 1 of your Benched {P} Pokémon."
    playable: {
      and: [
        { gte: [inDiscard({ energyType: 'Psychic' }), 1] },
        { gte: [{ pokemon: { zone: 'myBench', filter: { type: 'Psychic' } } }, 1] },
      ],
    },
    play: [
      { op: 'chooseCards', from: 'discard', filter: { energyType: 'Psychic' }, min: 1, max: 1, as: 'e' },
      { op: 'chooseSlots', from: 'myBench', filter: { type: 'Psychic' }, min: 1, max: 1, as: 't', prompt: 'Attach to which Benched Psychic Pokémon?' },
      { op: 'attach', cards: 'e', to: { v: 't' } },
    ],
  },

  // ---------------------------------------------------------------- Energy
  {
    id: 'me03-088',
    name: 'Telepathic Psychic Energy',
    // TCGdex lists this Special Energy as "Normal"; it is a Special Energy.
    fix: { specialEnergy: true },
    provides: ['Psychic'],
    // "When you attach this card from your hand to a {P} Pokémon, search your deck for up to 2 Basic {P} Pokémon and put them onto your Bench. Then, shuffle your deck."
    triggers: [
      {
        on: 'attachFromHand',
        when: { slotIs: { ref: 'self', filter: { type: 'Psychic' } } },
        program: searchToBench({ type: 'Psychic' }, 2),
      },
    ],
  },
];

void BENCH_SPACE;
void damageOneOf;
