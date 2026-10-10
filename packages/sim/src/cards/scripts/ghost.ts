/**
 * Gauntlet card scripts, lane "ghost" (see roadmap/plans/battle-sim/PLAN.md).
 * Written from the printed text in frames.ts; quotes below are that text. One
 * scenario test per card in src/__tests__/cards-ghost.test.ts.
 */
import type { AbilityScript, CardScript } from '../../dsl.js';
import './ghost-customs.js';
import { BENCH_SPACE, NO_RULE_BOX } from './helpers.js';

/** "Once during your turn, you may put N damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out." */
function cursedBlast(n: number): AbilityScript {
  return {
    name: 'Cursed Blast',
    activated: {
      program: [
        { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: `Put ${n} damage counters on which Pokémon?` },
        { op: 'counters', n, to: { v: 't' } },
        { op: 'knockOut', target: 'self' },
      ],
    },
  };
}

export const GHOST: CardScript[] = [
  // ---------------------------------------------------------------- Dragapult ex
  {
    id: 'sv06-130',
    name: 'Dragapult ex',
    // Tera Pokémon ex: the frame carries no Tera marker.
    fix: { tera: true },
    attacks: {
      // "Put 6 damage counters on your opponent's Benched Pokémon in any way you like."
      'Phantom Dive': {
        post: [
          {
            op: 'repeat',
            n: 6,
            body: [
              { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: 'Put a damage counter on which Benched Pokémon?' },
              { op: 'counters', n: 1, to: { v: 't' } },
            ],
          },
        ],
      },
    },
    notes: 'Phantom Dive places its 6 counters one at a time (6 decisions), which is "any way you like".',
  },
  {
    id: 'sv06-129',
    name: 'Drakloak',
    abilities: [
      {
        // "Once during your turn, you may look at the top 2 cards of your deck and put 1 of them into your hand. Put the other card on the bottom of your deck."
        name: 'Recon Directive',
        activated: { program: [{ op: 'custom', fn: 'lookTopPick', args: { n: 2 } }], when: { gte: [{ deckSize: 'self' }, 1] } },
      },
    ],
  },
  {
    id: 'sv06-095',
    name: 'Munkidori',
    abilities: [
      {
        // "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon."
        name: 'Adrena-Brain',
        activated: {
          when: {
            and: [
              { gte: [{ energyOn: 'self', type: 'Darkness' }, 1] },
              { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] },
              { custom: 'countersMovable' },
            ],
          },
          program: [
            { op: 'chooseSlots', from: 'myPokemon', filter: { damaged: true }, min: 1, max: 1, as: 'from', prompt: 'Move damage counters from which of your Pokémon?' },
            { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 'to', prompt: "Move them to which of your opponent's Pokémon?" },
            { op: 'custom', fn: 'moveCounters', args: { from: 'from', to: 'to', max: 3 } },
          ],
        },
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Confused."
      'Mind Bend': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
    notes: "Adrena-Brain is not offered while a Watchful Eye-style countersFixed static is live, or when none of your Pokémon has damage counters.",
  },
  {
    id: 'me02.5-016',
    name: 'Budew',
    attacks: {
      // "During your opponent's next turn, they can't play any Item cards from their hand."
      'Itchy Pollen': { post: [{ op: 'effect', static: { k: 'itemLock' }, onPlayer: 'opp', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv10-010',
    name: 'Shaymin',
    abilities: [
      // "Prevent all damage done to your Benched Pokémon that don't have a Rule Box by attacks from your opponent's Pokémon."
      { name: 'Flower Curtain', statics: [{ effect: { k: 'preventDamage' }, scope: 'myBench', filter: NO_RULE_BOX }] },
    ],
  },
  {
    id: 'me02-014',
    name: 'Moltres',
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 90 more damage."
      'Fighting Wings': { damage: { add: [20, { cond: { slotIs: { ref: 'defender', filter: { ex: true } } }, then: 90, else: 0 }] } },
    },
  },
  {
    id: 'sv07-133',
    name: 'Crispin',
    // "Search your deck for up to 2 Basic Energy cards of different types, reveal them, and put 1 of them into your hand.
    //  Attach the other to 1 of your Pokémon. Then, shuffle your deck."
    play: [
      { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: 1, as: 'e1', reveal: true, prompt: 'Search for a Basic Energy card (or none)' },
      { op: 'if', cond: { gte: [{ len: 'e1' }, 1] }, then: [{ op: 'custom', fn: 'chooseEnergyOfOtherType', args: { first: 'e1', as: 'found' } }] },
      { op: 'custom', fn: 'pickFromVar', args: { from: 'found', n: 1, as: 'toHand', rest: 'toAttach', prompt: 'Put which Energy into your hand? (the other is attached)' } },
      { op: 'move', cards: 'toHand', to: 'hand' },
      {
        op: 'if',
        cond: { gte: [{ len: 'toAttach' }, 1] },
        then: [
          { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach the other Energy to which Pokémon?' },
          { op: 'attach', cards: 'toAttach', to: { v: 't' } },
        ],
      },
      { op: 'shuffle' },
    ],
    notes: 'With only 1 Energy found it goes to the hand (nothing is attached).',
  },
  {
    id: 'me03-071',
    name: 'Crushing Hammer',
    // "Flip a coin. If heads, discard an Energy from 1 of your opponent's Pokémon."
    playable: { gte: [{ pokemon: { zone: 'oppPokemon', filter: { energized: true } } }, 1] },
    play: [
      { op: 'flip', n: 1, as: 'h' },
      {
        op: 'if',
        cond: { gte: [{ v: 'h' }, 1] },
        then: [
          { op: 'chooseSlots', from: 'oppPokemon', filter: { energized: true }, min: 1, max: 1, as: 't', prompt: 'Discard an Energy from which Pokémon?' },
          { op: 'discardEnergy', from: { v: 't' }, count: 1 },
        ],
      },
    ],
    notes: 'Not playable while the opponent has no Energy in play.',
  },

  // ---------------------------------------------------------------- Phantom Puppeteer (Dusknoir)
  {
    id: 'sv08.5-035',
    name: 'Duskull',
    attacks: {
      // "Put up to 3 Duskull from your discard pile onto your Bench."
      'Come and Get You': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { name: 'Duskull' }, min: 0, max: { min: [3, BENCH_SPACE] }, as: 'x', prompt: 'Put up to 3 Duskull onto your Bench' },
          { op: 'move', cards: 'x', to: 'bench' },
        ],
      },
    },
  },
  { id: 'sv06.5-019', name: 'Dusclops', abilities: [cursedBlast(5)] },
  {
    id: 'sv06.5-020',
    name: 'Dusknoir',
    abilities: [cursedBlast(13)],
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Shadow Bind': { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'me01-125',
    name: 'Rare Candy',
    // "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the
    //  Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn."
    playable: { custom: 'rareCandyPlayable' },
    play: [{ op: 'custom', fn: 'rareCandy' }],
    notes:
      'Playable only when some Basic in play (not put into play this turn) has a matching Stage 2 in hand. The Stage 1 link is read from this game\'s cards, else from the frame snapshot.',
  },

  // ---------------------------------------------------------------- Gengar ex / Bastiodon
  {
    id: 'sv05-102',
    name: 'Gastly',
    attacks: {
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      'Mysterious Beam': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'discardEnergy', from: 'defender', count: 1 }] },
        ],
      },
    },
  },
  {
    id: 'sv05-103',
    name: 'Haunter',
    attacks: {
      // "Your opponent's Active Pokémon is now Poisoned."
      'Super Poison Breath': { post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv05-104',
    name: 'Gengar ex',
    abilities: [
      {
        // "Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon."
        name: 'Gnawing Curse',
        triggers: [{ on: 'oppAttachFromHand', program: [{ op: 'counters', n: 2, to: { v: '__target' } }] }],
      },
    ],
    attacks: {
      // "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon."
      'Tricky Steps': {
        post: [
          {
            op: 'if',
            cond: { and: [{ gte: [{ energyOn: 'oppActive' }, 1] }, { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }] },
            then: [
              {
                op: 'may',
                prompt: "Move an Energy from your opponent's Active Pokémon to their Bench?",
                body: [
                  { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't', prompt: 'Move it to which Benched Pokémon?' },
                  { op: 'custom', fn: 'moveOppActiveEnergy', args: { to: 't' } },
                ],
              },
            ],
          },
        ],
      },
    },
    notes: 'Gnawing Curse fires for each Gengar ex in play, from the Bench too, on Energy attached from hand by an action or by an effect.',
  },
  {
    id: 'me05-061',
    name: 'Shieldon',
    attacks: {
      // "Discard an Energy from your opponent's Active Pokémon."
      'Smithereen Smash': { post: [{ op: 'discardEnergy', from: 'defender', count: 1 }] },
    },
  },
  {
    id: 'me05-062',
    name: 'Bastiodon',
    abilities: [
      {
        // "As long as this Pokémon is on your Bench, prevent all damage done to each of your Pokémon by attacks from your opponent's Pokémon that have 2 or less Energy attached."
        name: 'Ancient Bulwark',
        statics: [{ effect: { k: 'preventDamage', attackerMaxEnergy: 2 }, scope: 'myPokemon', when: { onBench: 'self' } }],
      },
    ],
    notes: 'The attacker\'s Energy is counted in units provided (a Special Energy providing 2 counts as 2), as "Energy attached" counts elsewhere.',
  },
  {
    id: 'me05-072',
    name: 'Antique Armor Fossil',
    // "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.
    //  At any time during your turn, you may discard this card from play."
    fix: { playAsBasic: { hp: 60, type: 'Colorless', cantRetreat: true, noConditions: true, discardable: true } },
    abilities: [
      {
        // "As long as this Pokémon is in the Active Spot, all of your Pokémon take 10 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance)."
        name: 'Protective Armor',
        statics: [{ effect: { k: 'damageIn', amount: -10 }, scope: 'myPokemon', when: { inActive: 'self' } }],
      },
    ],
    status: 'needs_ruling',
    notes:
      'Played from hand as an Item (Item locks stop it) and never placed during setup or counted for mulligans, following the rulings on earlier "play as if it were a Basic Pokémon" fossils. ' +
      'Knocked Out it gives up 1 Prize; discarded from play it gives none. Ruling to confirm: setup placement for the Mega-era Antique fossils.',
  },
  {
    id: 'me05-076',
    name: 'Fossil Quarry',
    // "Once during each player's turn, that player may search their deck for up to 2 Item cards that have "Antique" in their name and put them onto their Bench. Then, that player shuffles their deck."
    stadiumAbility: {
      when: { not: { benchFull: 'self' } },
      program: [
        { op: 'chooseCards', from: 'deck', filter: { ttype: 'item', nameIncludes: 'Antique' }, min: 0, max: { min: [2, BENCH_SPACE] }, as: 'found', prompt: 'Put up to 2 Antique Items onto your Bench' },
        { op: 'move', cards: 'found', to: 'bench' },
        { op: 'shuffle' },
      ],
    },
  },
  {
    id: 'sv06.5-057',
    name: "Colress's Tenacity",
    // "Search your deck for a Stadium card and an Energy card, reveal them, and put them into your hand. Then, shuffle your deck."
    play: [
      { op: 'chooseCards', from: 'deck', min: 0, max: 2, as: 'found', reveal: true, oneEach: [{ ttype: 'stadium' }, { cat: 'energy' }] },
      { op: 'move', cards: 'found', to: 'hand' },
      { op: 'shuffle' },
    ],
  },
];
