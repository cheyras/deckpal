/**
 * Standard batch c07: Trainers, an Energy and Pokémon of Mega Evolution-Ascended Heroes (me02.5) and Perfect Order (me03).
 * Written from the printed text in frames.ts; quotes below are that text. One test per card in
 * src/__tests__/cards-std-c07.test.ts.
 *
 * Not scripted (the vocabulary lacks the capability; see the batch report):
 *  - me02.5-203 Team Rocket's Factory: needs a per-turn record of WHICH Supporter was played ("a Supporter card that has
 *    "Team Rocket" in its name from their hand this turn"); the state keeps only a "played a Supporter" flag.
 *  - me02.5-211 Thick Scale: damageIn filtered by the ATTACKER's type ({G}, {R}, {W} or {L} Pokémon).
 *  - me02.5-217 Team Rocket's Energy: provides "2 in any combination of {P} Energy and {D} Energy" (a restricted-choice
 *    Energy unit) and "can only be attached to a Team Rocket's Pokémon" (an attach restriction).
 *  - me03-024 Aurorus: Tundra Wall "doesn't stack" (damageIn has no noStack key, so two Aurorus would take off 100).
 */
import type { CardScript, Cond, Expr, Filter, Program } from '../../dsl.js';
import { searchToHand } from './helpers.js';
import './std-c07-customs.js';
import './std-seed1-customs.js'; // std.discardRandomFromHand

/** "Team Rocket's Pokémon" (the printed name starts with "Team Rocket's"). */
const TR: Filter = { nameIncludes: "Team Rocket's" };
const NOT_TR: Filter = { not: TR };

/** "If all of your Pokémon in play are Team Rocket's Pokémon" */
const ALL_TR: Cond = { eq: [{ pokemon: { zone: 'myPokemon', filter: NOT_TR } }, 0] };

/** "Flip a coin. If heads, ..." */
function onHeads(...then: Program): Program {
  return [{ op: 'flip', n: 1, as: 'h' }, { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then }];
}

/** "<n> more damage if <cond>" */
function moreIf(cond: Cond, n: number): Expr {
  return { cond, then: n, else: 0 };
}

export const STD_C07: CardScript[] = [
  // ---------------------------------------------------------------- Trainers
  {
    id: 'me02.5-202',
    name: "Team Rocket's Ariana",
    // "Draw cards until you have 5 cards in your hand. If all of your Pokémon in play are Team Rocket's Pokémon, draw cards until you have 8 cards in your hand instead."
    // Played from the hand, so with the Supporter in hand it needs at most 5 (8) cards there: "you have 5" counts the others only.
    // A Trainer that would draw nothing can't be played (TPCi 2014-11-13).
    playable: {
      and: [
        { gte: [{ deckSize: 'self' }, 1] },
        { or: [{ lte: [{ handSize: 'self' }, 5] }, { and: [ALL_TR, { lte: [{ handSize: 'self' }, 8] }] }] },
      ],
    },
    play: [{ op: 'draw', n: { max: [0, { sub: [{ cond: ALL_TR, then: 8, else: 5 }, { handSize: 'self' }] }] } }],
  },
  {
    id: 'me02.5-204',
    name: "Team Rocket's Giovanni",
    // "Switch your Active Team Rocket's Pokémon with 1 of your Benched Team Rocket's Pokémon. If you do, switch in 1 of your opponent's Benched Pokémon to the Active Spot."
    // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2168/): you make every choice for both players' switches.
    playable: { and: [{ slotIs: { ref: 'myActive', filter: TR } }, { gte: [{ pokemon: { zone: 'myBench', filter: TR } }, 1] }] },
    play: [
      { op: 'chooseSlots', from: 'myBench', filter: TR, min: 1, max: 1, as: 't', prompt: "Switch with which Benched Team Rocket's Pokémon?" },
      { op: 'switch', who: 'self', with: { v: 't' } },
      { op: 'if', cond: { inActive: { v: 't' } }, then: [{ op: 'switch', who: 'opp', chooser: 'self' }] },
    ],
    notes:
      'Ruling 2154 (Destined Rivals FAQ, TPCi 2025-05-29): if the opponent\'s chosen Benched Pokémon is Cetitan ex (Snow Camouflage) the opponent-side switch is blocked ' +
      '(the Benched Pokémon is the target) while your own switch still happens. Cetitan ex is not scripted and the engine has no Trainer-effect prevention, so that case is not modelled.',
  },
  {
    id: 'me02.5-205',
    name: "Team Rocket's Great Ball",
    // "Flip a coin. If heads, search your deck for an Evolution Team Rocket's Pokémon, reveal it, and put it into your hand.
    //  If tails, search your deck for a Basic Team Rocket's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
    play: [
      { op: 'flip', n: 1, as: 'h' },
      {
        op: 'if',
        cond: { gte: [{ v: 'h' }, 1] },
        then: [{ op: 'chooseCards', from: 'deck', filter: { cat: 'pokemon', stage: 'evolution', ...TR }, min: 0, max: 1, as: 'found', reveal: true }],
        else: [{ op: 'chooseCards', from: 'deck', filter: { cat: 'pokemon', stage: 'basic', ...TR }, min: 0, max: 1, as: 'found', reveal: true }],
      },
      { op: 'move', cards: 'found', to: 'hand' },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'me02.5-206',
    name: "Team Rocket's Hypnotizer",
    // "If the Team Rocket's Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon
    //  (even if this Team Rocket's Pokémon is Knocked Out), the Attacking Pokémon is now Asleep."
    triggers: [{ on: 'damagedByAttackActive', when: { slotIs: { ref: 'self', filter: TR } }, program: [{ op: 'condition', cond: 'asleep', to: 'oppActive' }] }],
    notes:
      'The Attacking Pokémon is taken to be the opponent\'s Active Pokémon when the trigger resolves (triggers run after the whole attack); an attack that switches ' +
      'its user out after damage (Salazzle ex, Dire Nails) would put the new Active Pokémon to sleep instead.',
  },
  {
    id: 'me02.5-208',
    name: "Team Rocket's Proton",
    // "If you go first, you may use this card during your first turn."
    firstTurnSupporter: true,
    // "Search your deck for up to 3 Basic Team Rocket's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
    // "Up to 3" on a Trainer is 1-3 (TPCi 2026-02-19).
    play: searchToHand({ cat: 'pokemon', stage: 'basic', ...TR }, 3, { min: 1 }),
  },
  {
    id: 'me02.5-214',
    name: 'Urbain',
    // "Draw 3 cards."
    play: [{ op: 'draw', n: 3 }],
  },
  {
    id: 'me02.5-215',
    name: 'Waitress',
    // "Look at the top 6 cards of your deck and attach a Basic Energy card you find there to 1 of your Pokémon. Shuffle the other cards back into your deck."
    playable: { gte: [{ deckSize: 'self' }, 1] },
    play: [
      { op: 'custom', fn: 'c07.lookTopPick', args: { n: 6, filter: { basicEnergy: true }, as: 'e' } },
      {
        op: 'if',
        cond: { gte: [{ len: 'e' }, 1] },
        then: [
          { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach it to which of your Pokémon?' },
          { op: 'attach', cards: 'e', to: { v: 't' } },
        ],
      },
      { op: 'shuffle' },
    ],
  },
  {
    id: 'me02.5-258',
    name: 'Cheren',
    // "Draw 3 cards."
    play: [{ op: 'draw', n: 3 }],
  },

  // ---------------------------------------------------------------- Energy
  {
    id: 'me02.5-216',
    name: 'Prism Energy',
    // TCGdex lists this Special Energy as "Normal"; it is a Special Energy.
    fix: { specialEnergy: true },
    // "As long as this card is attached to a Pokémon, it provides {C} Energy.
    //  If this card is attached to a Basic Pokémon, this card provides every type of Energy but provides only 1 Energy at a time."
    // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2194/): Prism Energy can be discarded by Firefighting as {R} only when attached to a Basic Pokémon; on a non-Basic it does not count as {R}.
    // Rulings 2291 / 2249: counts for "for each {R} / {W} Energy" and "at least N {W} Energy" effects that don't say Basic Energy.
    provides: ['Colorless'],
    providesAny: { n: 1, when: { stage: 'basic' } },
  },

  // ---------------------------------------------------------------- Pokémon
  {
    id: 'me02.5-289',
    name: "Steven's Metagross ex",
    abilities: [
      {
        name: 'X-Boot',
        // "Once during your turn, you may search your deck for a Basic {P} Energy card, a Basic {M} Energy card, or 1 of each and attach them to your {P} Pokémon and {M} Pokémon in any way you like. Then, shuffle your deck."
        activated: {
          when: { gte: [{ deckSize: 'self' }, 1] },
          program: [
            // One {P}, one {M}, or one of each: at least one while the deck has either.
            {
              op: 'chooseCards',
              from: 'deck',
              filter: { energyType: 'Psychic' },
              min: { cond: { eq: [{ count: { zone: 'deck', filter: { energyType: 'Metal' } } }, 0] }, then: 1, else: 0 },
              max: 1,
              as: 'p',
              prompt: 'Search for a Basic {P} Energy card',
            },
            {
              op: 'chooseCards',
              from: 'deck',
              filter: { energyType: 'Metal' },
              min: { cond: { eq: [{ len: 'p' }, 0] }, then: 1, else: 0 },
              max: 1,
              as: 'm',
              prompt: 'Search for a Basic {M} Energy card',
            },
            {
              op: 'if',
              cond: { gte: [{ len: 'p' }, 1] },
              then: [
                { op: 'chooseSlots', from: 'myPokemon', filter: { type: ['Psychic', 'Metal'] }, min: 1, max: 1, as: 'tp', prompt: 'Attach the {P} Energy to which {P} or {M} Pokémon?' },
                { op: 'attach', cards: 'p', to: { v: 'tp' } },
              ],
            },
            {
              op: 'if',
              cond: { gte: [{ len: 'm' }, 1] },
              then: [
                { op: 'chooseSlots', from: 'myPokemon', filter: { type: ['Psychic', 'Metal'] }, min: 1, max: 1, as: 'tm', prompt: 'Attach the {M} Energy to which {P} or {M} Pokémon?' },
                { op: 'attach', cards: 'm', to: { v: 'tm' } },
              ],
            },
            { op: 'shuffle' },
          ],
        },
      },
    ],
  },
  {
    id: 'me03-003',
    name: 'Shaymin',
    attacks: {
      // "Search your deck for an Energy card and attach it to 1 of your Benched {G} Pokémon. Then, shuffle your deck."
      // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2318/): yes, Special Energy can be found too, since the attack puts no limit on the Energy card's kind.
      'Send Flowers': {
        program: [
          { op: 'chooseSlots', from: 'myBench', filter: { type: 'Grass' }, min: 1, max: 1, as: 't', prompt: 'Attach it to which Benched {G} Pokémon?' },
          {
            op: 'if',
            cond: { gte: [{ len: 't' }, 1] },
            then: [
              { op: 'chooseCards', from: 'deck', filter: { cat: 'energy' }, min: 0, max: 1, as: 'e' },
              { op: 'attach', cards: 'e', to: { v: 't' } },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    },
    notes: 'The Benched {G} Pokémon is chosen before the search (the result is the same); with no Benched {G} Pokémon there is nothing to attach to, so nothing is searched or shuffled.',
  },
  {
    id: 'me03-006',
    name: 'Serperior',
    attacks: {
      // "This attack does 20 damage for each of your Pokémon in play."
      'Regal Command': { damage: { mul: [20, { pokemon: { zone: 'myPokemon' } }] } },
      // "If Rosa's Encouragement is in your discard pile, this attack does 150 more damage."
      // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2319/): no, it only checks whether a Rosa's Encouragement sits in the discard pile, so two copies still add just 150.
      'Solar Coiling': { damage: { add: [100, moreIf({ gte: [{ count: { zone: 'discard', filter: { name: "Rosa's Encouragement" } } }, 1] }, 150)] } },
    },
  },
  {
    id: 'me03-009',
    name: 'Vivillon',
    attacks: {
      // "If a Stadium is in play, this attack does 60 more damage."
      'Blow Through': { damage: { add: [60, moreIf({ stadium: true }, 60)] } },
    },
    abilities: [
      {
        name: 'Grand Wing',
        // "Once during your turn, you may use this Ability. Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 4 cards."
        // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2306/): no, Grand Wing cannot be used when the opponent has zero cards in hand.
        activated: {
          when: { gte: [{ handSize: 'opp' }, 1] },
          program: [
            { op: 'custom', fn: 'shuffleHandToBottom', args: { who: 'opp' } },
            { op: 'if', cond: { gt: [{ v: 'moved' }, 0] }, then: [{ op: 'draw', n: 4, who: 'opp' }] },
          ],
        },
      },
    ],
  },
  {
    id: 'me03-012',
    name: 'Decidueye ex',
    attacks: {
      // "Discard an Energy from your opponent's Active Pokémon."
      'Crushing Arrow': { post: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
    },
    abilities: [
      {
        name: "Sniper's Eye",
        // "If your opponent has exactly 4 cards in their hand, ignore all {C} Energy in the costs of attacks used by this Pokémon."
        // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2311/): yes, while the opponent has exactly 4 cards in hand it drops every {C} from the cost of any attack Decidueye ex can use, including the underlying Dartrix's Feather Shot reached through Memory Dive.
        // (so the underlying Dartrix's attacks lose their {C} too: the static covers every attack)
        statics: [{ effect: { k: 'attackCostC', delta: -9 }, scope: 'self', when: { eq: [{ handSize: 'opp' }, 4] } }],
      },
    ],
  },
  {
    id: 'me03-014',
    name: 'Talonflame',
    abilities: [
      {
        name: 'Sky Hunt',
        // "Once during your turn, you may use this Ability. Flip a coin. If heads, discard a random card from your opponent's hand."
        activated: { program: onHeads({ op: 'custom', fn: 'std.discardRandomFromHand', args: { who: 'opp' } }) },
      },
    ],
  },
  {
    id: 'me03-016',
    name: 'Salazzle ex',
    attacks: {
      // "Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck."
      // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2315/): no, you cannot take zero cards while your deck still has any.
      'Nasty Plot': {
        program: [
          { op: 'chooseCards', from: 'deck', min: 1, max: 2, as: 'x' },
          { op: 'move', cards: 'x', to: 'hand' },
          { op: 'shuffle' },
        ],
      },
      'Dire Nails': {
        post: [
          // "Your opponent's Active Pokémon is now Burned and Poisoned."
          { op: 'condition', cond: 'burned', to: 'oppActive' },
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
          // "Switch this Pokémon with 1 of your Benched Pokémon."
          { op: 'switch', who: 'self' },
        ],
      },
    },
  },
  {
    id: 'me03-017',
    name: 'Turtonator',
    attacks: {
      // "Flip a coin. If heads, this attack does 80 more damage."
      'Heat Breath': { pre: [{ op: 'flip', n: 1, as: 'h' }], damage: { add: [80, { mul: [80, { v: 'h' }] }] } },
    },
    abilities: [
      {
        name: 'Shell Spikes',
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), discard an Energy from the Attacking Pokémon."
        // Ruling #2310 (https://compendium.pokegym.net/ruling/2310/): Mist Energy only stops effects of attacks and this is an Ability, so the discard
        //  (the owner's choice of the attacker's Energy) still happens against a Pokémon with Mist Energy.
        triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] }],
      },
    ],
    notes: 'The Attacking Pokémon is taken to be the opponent\'s Active Pokémon when the trigger resolves (an attack that switches its user out after damage, Salazzle ex Dire Nails, would discard from the new Active instead).',
  },
  {
    id: 'me03-019',
    name: 'Dewgong',
    abilities: [
      {
        name: 'Wash Out',
        // "As often as you like during your turn, you may use this Ability. Move a {W} Energy from 1 of your Benched Pokémon to your Active Pokémon."
        // Ruling (Perfect Order FAQ, TPCi Rules Team 2026-03-26, https://compendium.pokegym.net/ruling/2312/): yes, a Special Energy can be moved if it is providing {W}; the Ability does not require a Basic Energy.
        activated: {
          oncePerTurn: false,
          when: { custom: 'c07.benchHasEnergyOfType', args: { type: 'Water' } },
          program: [{ op: 'custom', fn: 'c07.moveEnergyToActive', args: { type: 'Water' } }],
        },
      },
    ],
  },
  {
    id: 'me03-021',
    name: 'Mega Starmie ex',
    attacks: {
      // "This attack also does 50 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Jetting Blow': {
        post: [
          { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 'b', prompt: "Choose 1 of your opponent's Benched Pokémon" },
          { op: 'damage', amount: 50, to: { v: 'b' } },
        ],
      },
      // "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon."
      'Nebula Beam': { ignore: { weakness: true, resistance: true, defenderEffects: true } },
    },
  },
  {
    id: 'me03-022',
    name: 'Lapras ex',
    attacks: {
      'Hydro Turn': {
        // "This attack does 30 damage for each {W} Energy attached to this Pokémon."
        damage: { mul: [30, { energyOn: 'self', type: 'Water' }] },
        // "Switch this Pokémon with 1 of your Benched Pokémon."
        post: [{ op: 'switch', who: 'self' }],
      },
    },
  },
  {
    id: 'me03-025',
    name: 'Volcanion',
    attacks: {
      // "Flip a coin for each {W} Energy attached to this Pokémon. This attack does 90 damage for each heads."
      'Powerful Steam': {
        pre: [{ op: 'flip', n: { energyOn: 'self', type: 'Water' }, as: 'h' }],
        damage: { mul: [90, { v: 'h' }] },
      },
    },
  },
];
