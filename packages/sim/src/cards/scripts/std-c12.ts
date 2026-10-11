/**
 * Standard batch c12: Pokémon, Trainers and an Energy of Mega Evolution-Chaos... (me05) and the Mega promos (mep).
 * Written from the printed text in frames.ts; quotes below are that text. One test per card in
 * src/__tests__/cards-std-c12.test.ts.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - me05-074 Backtrack Badge: "ignore all results of those coin flips and begin flipping those coins again" -- no way to
 *    redo the flips of an attack after they have been made.
 *  - me05-082 Tremendous Bomb: needs the AMOUNT of damage an attack did to this Pokémon ("takes 240 or more damage") in a
 *    trigger condition, and the attacking Pokémon being a Mega Evolution Pokémon ex; no trigger carries the damage dealt.
 *  - mep-082 Miraidon: Photon Cord needs the `knockedOutByAttack` trigger, which is declared but never fired.
 */
import type { CardScript, Filter } from '../../dsl.js';
import { BENCH_SPACE } from './helpers.js';
import './meta-zoroark-customs.js'; // slotTopCard
import './meta-charizard-customs.js'; // charizard.discardEnergyAmong
import './std-c01-customs.js'; // c01.benchCards
import './std-c12-customs.js';
import './std-seed2-customs.js'; // seed2.healEach, seed2.sumAttached

const MEGA_EX: Filter = { mega: true, ex: true };

export const STD_C12: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon: me05
  {
    id: 'me05-052',
    name: 'Malamar',
    attacks: {
      // "Your opponent's Active Pokémon is now Confused."
      Perplex: { program: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
      // "If your opponent's Active Pokémon isn't Confused, this attack does nothing."
      'Brain Crush': {
        program: [{ op: 'if', cond: { slotIs: { ref: 'oppActive', filter: { condition: 'confused' } } }, then: [{ op: 'damage', amount: 130 }] }],
      },
    },
  },
  {
    id: 'me05-054',
    name: 'Thievul',
    attacks: {
      // "If you have no cards in your hand, choose an attack from 1 of your opponent's Pokémon in play and use it as this attack."
      // Ruling (Pitch Black FAQ, TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2409/): yes, you need not have the Energy the copied attack requires; you only need to be able to use Skill Thief.
      // Ruling (Pitch Black FAQ, TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2402/): Thievul is the Pokémon using the copied attack and is an Evolution Pokémon, so Flashing Barrier prevents the damage.
      'Skill Thief': {
        program: [
          {
            op: 'if',
            cond: { eq: [{ handSize: 'self' }, 0] },
            then: [
              { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Pokémon in play" },
              { op: 'custom', fn: 'slotTopCard', args: { from: 't', as: 'c' } },
              { op: 'useAttackOf', card: 'c' },
            ],
          },
        ],
      },
    },
    notes: 'Compendium #2409 (no Energy needed for the copied attack) and #2402 (Thievul, an Evolution Pokémon, is the attacker, so "from Evolution Pokémon" prevention applies).',
  },
  {
    id: 'me05-056',
    name: 'Zarude',
    attacks: {
      // "This attack also does 30 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Overhead Throw': {
        post: [
          { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 'b', prompt: 'Choose 1 of your Benched Pokémon to damage' },
          { op: 'damage', amount: 30, to: { v: 'b' } },
        ],
      },
      // "If your Benched Pokémon have any Shadowy {D} Energy attached, this attack does 70 more damage."
      'Shadowy Whip': {
        damage: {
          add: [
            100,
            {
              cond: { gte: [{ pokemon: { zone: 'myBench', filter: { energy: { name: 'Shadowy Darkness Energy' } } } }, 1] },
              then: 70,
              else: 0,
            },
          ],
        },
      },
    },
  },
  {
    id: 'me05-058',
    name: 'Mabosstiff',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 100 more damage from attacks (after applying Weakness and Resistance)."
      'Plunging Headbutt': {
        post: [{ op: 'effect', static: { k: 'damageIn', amount: 100, fromOpp: true }, on: 'self', duration: 'oppNextTurn' }],
      },
    },
  },
  {
    id: 'me05-059',
    name: 'Chi-Yu',
    attacks: {
      // "If this Pokémon has 2 or more damage counters on it, this attack does 90 more damage. This attack's damage isn't affected by Weakness."
      'Whirling Envy': {
        damage: { add: [20, { cond: { gte: [{ countersOn: 'self' }, 2] }, then: 90, else: 0 }] },
        ignore: { weakness: true },
      },
    },
  },
  {
    id: 'me05-060',
    name: 'Skarmory',
    attacks: {
      // "Discard up to 2 Basic {M} Energy cards from your hand, and this attack does 40 damage for each card you discarded in this way."
      'Steel Cutter': {
        pre: [
          { op: 'chooseCards', from: 'hand', filter: { energyType: 'Metal' }, min: 0, max: 2, as: 'x', prompt: 'Discard up to 2 Basic {M} Energy cards' },
          { op: 'move', cards: 'x', to: 'discard' },
        ],
        damage: { mul: [40, { len: 'x' }] },
      },
    },
  },
  {
    id: 'me05-064',
    name: 'Bronzong',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 100 less damage from attacks from Evolution Pokémon (after applying Weakness and Resistance)."
      'Metal Block': {
        post: [{ op: 'effect', static: { k: 'damageIn', amount: -100, fromOpp: true, attacker: { stage: 'evolution' } }, on: 'self', duration: 'oppNextTurn' }],
      },
    },
  },
  {
    id: 'me05-068',
    name: 'Toucannon',
    abilities: [
      {
        // "Once during your turn, you may use this Ability. Draw a card."
        name: 'Aerial Draw',
        activated: { when: { gte: [{ deckSize: 'self' }, 1] }, program: [{ op: 'draw', n: 1 }] },
      },
    ],
    attacks: {
      // "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's)."
      'Feather Rondo': {
        damage: { add: [60, { mul: [20, { add: [{ pokemon: { zone: 'myBench' } }, { pokemon: { zone: 'oppBench' } }] }] }] },
      },
    },
  },
  {
    id: 'me05-071',
    name: 'Bombirdier',
    attacks: {
      // "Flip 2 coins. If both of them are heads, search your deck for a Pokémon and put it onto your Bench. Then, shuffle your deck."
      'Challenging Delivery': {
        program: [
          { op: 'flip', n: 2, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 2] },
            then: [
              { op: 'chooseCards', from: 'deck', filter: { cat: 'pokemon' }, min: 0, max: { min: [1, BENCH_SPACE] }, as: 'found', prompt: 'Search your deck for a Pokémon' },
              { op: 'custom', fn: 'c01.benchCards', args: { cards: 'found' } },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Trainers: me05
  {
    id: 'me05-073',
    name: 'Antique Skull Fossil',
    // "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.
    //  At any time during your turn, you may discard this card from play."
    fix: { playAsBasic: { hp: 60, type: 'Colorless', cantRetreat: true, noConditions: true, discardable: true } },
    abilities: [
      {
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon."
        // The Attacking Pokémon is the opponent's Active Pokémon.
        name: 'Spiny Skull',
        triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'counters', n: 3, to: 'oppActive' }] }],
      },
    ],
    status: 'implemented',
    notes:
      'Played from hand as an Item, like Antique Armor Fossil. Ruling (Pitch Black FAQ, TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2386/): ' +
      'Antique Fossils have no Retreat Cost at all (not a cost of zero), and no effect, such as Binding Flame, can give them one. -- cantRetreat.',
  },
  {
    id: 'me05-079',
    name: 'Jett',
    // "Draw a card for each of your opponent's Mega Evolution Pokémon ex in play."
    play: [{ op: 'draw', n: { pokemon: { zone: 'oppPokemon', filter: MEGA_EX } } }],
    // No effect, no play (TPCi 2014-11-13): with no Mega Evolution Pokémon ex in play it would draw nothing.
    playable: { gte: [{ pokemon: { zone: 'oppPokemon', filter: MEGA_EX } }, 1] },
  },
  {
    id: 'me05-080',
    name: "Misty's Vitality",
    // "Search your deck for up to 4 Basic {W} Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck. Your turn ends."
    // "Up to" on a Trainer is 1 to 4 (TPCi 2026-02-19).
    play: [
      { op: 'chooseCards', from: 'deck', filter: { energyType: 'Water' }, min: 1, max: 4, as: 'found', prompt: 'Search your deck for up to 4 Basic {W} Energy cards' },
      {
        op: 'if',
        cond: { gte: [{ len: 'found' }, 1] },
        then: [
          { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach them to which of your Pokémon?' },
          { op: 'attach', cards: 'found', to: { v: 't' } },
        ],
      },
      { op: 'shuffle' },
      { op: 'custom', fn: 'c12.endTurn' },
    ],
  },
  {
    id: 'me05-081',
    name: 'Rust Syndicate Grunt',
    // "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn."
    // "Discard an Energy from 1 of your opponent's Pokémon."
    // Playable only if it would do something (TPCi 2014-11-13): the opponent has a Pokémon with Energy attached.
    playable: { and: [{ koLastTurn: 'self' }, { gte: [{ pokemon: { zone: 'oppPokemon', filter: { energized: true } } }, 1] }] },
    play: [
      { op: 'chooseSlots', from: 'oppPokemon', filter: { energized: true }, min: 1, max: 1, as: 't', prompt: "Discard an Energy from which of your opponent's Pokémon?" },
      { op: 'discardEnergy', from: { v: 't' }, count: 1 },
    ],
  },
  {
    id: 'me05-084',
    name: 'Voltaic Lightning Energy',
    // TCGdex lists this Special Energy as "Normal"; it is a Special Energy.
    fix: { specialEnergy: true },
    // "As long as this card is attached to a Pokémon, it provides {L} Energy."
    provides: ['Lightning'],
    // "Attacks used by the {L} Pokémon this card is attached to do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
    statics: [{ effect: { k: 'damageOut', amount: 20 }, scope: 'self', filter: { type: 'Lightning' } }],
  },

  // ---------------------------------------------------------------- Pokémon and Stadium: mep
  {
    id: 'mep-005',
    name: 'Drifloon',
    attacks: {
      // "Flip a coin. If heads, switch 1 of your opponent's Benched Pokémon with their Active Pokémon."
      Pull: {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'switch', who: 'opp', chooser: 'self' }] },
        ],
      },
    },
  },
  {
    id: 'mep-007',
    name: 'Psyduck',
    abilities: [
      // "Pokémon in play (both yours and your opponent's) lose all Abilities that require those Pokémon to be Knocked Out."
      { name: 'Damp', statics: [{ effect: { k: 'loseSelfKoAbilities' }, scope: 'allPokemon' }] },
    ],
  },
  {
    id: 'mep-008',
    name: 'Golduck',
    abilities: [
      // "Pokémon in play (both yours and your opponent's) lose all Abilities that require those Pokémon to be Knocked Out."
      { name: 'Damp', statics: [{ effect: { k: 'loseSelfKoAbilities' }, scope: 'allPokemon' }] },
    ],
    attacks: {
      // "This attack does 20 more damage for each {W} Energy attached to this Pokémon."
      'Hydro Pump': { damage: { add: [60, { mul: [20, { energyOn: 'self', type: 'Water' }] }] } },
    },
  },
  {
    id: 'mep-019',
    name: 'Whimsicott',
    attacks: {
      // "Heal all damage from 1 of your Benched Pokémon."
      'Healing Fluff': {
        program: [
          { op: 'chooseSlots', from: 'myBench', filter: { damaged: true }, min: 1, max: 1, as: 't', prompt: 'Heal all damage from which Benched Pokémon?' },
          { op: 'heal', amount: { mul: [10, { countersOn: { v: 't' } }] }, to: { v: 't' } },
        ],
      },
      // "Switch this Pokémon with 1 of your Benched Pokémon."
      'U-turn': { post: [{ op: 'switch', who: 'self' }] },
    },
  },
  {
    id: 'mep-021',
    name: 'Weavile',
    attacks: {
      // "If this Pokémon's remaining HP is 50 or less, this attack does 170 more damage."
      'Retaliatory Claw': {
        damage: { add: [20, { cond: { custom: 'c12.remainingHpAtMost', args: { n: 50 } }, then: 170, else: 0 }] },
      },
    },
  },
  {
    id: 'mep-023',
    name: 'Mega Charizard X ex',
    attacks: {
      // "Discard any amount of {R} Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way."
      'Inferno X': {
        pre: [{ op: 'custom', fn: 'charizard.discardEnergyAmong', args: { type: 'Fire', as: 'n' } }],
        damage: { mul: [90, { v: 'n' }] },
      },
    },
  },
  {
    id: 'mep-028',
    name: 'Celebratory Fanfare',
    // "Once during each player's turn, that player may heal 10 damage from each of their Pokémon. If a player healed any damage in this way, their turn ends."
    // Usable only while one of that player's Pokémon is damaged (otherwise nothing is healed and the turn would not end).
    stadiumAbility: {
      when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] },
      program: [
        { op: 'custom', fn: 'seed2.healEach', args: { amount: 10, zone: 'myPokemon', as: 'healed' } },
        { op: 'if', cond: { gte: [{ v: 'healed' }, 1] }, then: [{ op: 'custom', fn: 'c12.endTurn' }] },
      ],
    },
  },
  {
    id: 'mep-074',
    name: 'Delphox',
    abilities: [
      {
        // "Once during your turn, you may discard a Basic Fire Energy card from your hand in order to use this Ability. Draw cards until you have 7 cards in your hand."
        // Ruling (Chaos Rising FAQ, TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2343/): no, with 8 or more cards in hand the discard is a cost that leaves nothing to draw, so the Ability cannot be used and the {R} stays in hand.
        // With 8 or more cards the discard would leave 7 or more and nothing could be drawn, so it can't be used.
        name: 'Flaring Magic',
        activated: {
          when: { and: [{ lte: [{ handSize: 'self' }, 7] }, { gte: [{ count: { zone: 'hand', filter: { energyType: 'Fire' } } }, 1] }] },
          program: [
            { op: 'chooseCards', from: 'hand', filter: { energyType: 'Fire' }, min: 1, max: 1, as: 'x', prompt: 'Discard a Basic {R} Energy card' },
            { op: 'move', cards: 'x', to: 'discard' },
            { op: 'draw', n: { max: [0, { sub: [7, { handSize: 'self' }] }] } },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 30 damage for each Energy attached to all Pokémon."
      'Energized Storm': {
        pre: [{ op: 'custom', fn: 'seed2.sumAttached', args: { kind: 'energy', zone: 'allPokemon', as: 'n' } }],
        damage: { mul: [30, { v: 'n' }] },
      },
    },
    notes: 'Compendium #2343 (8+ cards in hand: the Ability can\'t be used, and no Energy is discarded).',
  },
];
