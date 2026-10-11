/**
 * Standard batch c24 (Surging Sparks cards sv08-020 .. sv08-074). Written from the printed text in frames.ts; quotes below are
 * that text. Tests: src/__tests__/cards-std-c24.test.ts.
 *
 * Not scripted, with the capability each needs:
 *  - sv08-042 Milotic ex: Sparkling Scales prevents damage AND effects only for attacks from Tera Pokémon; `preventDamage`'s
 *    `attacker` filter is honoured for damage only, not with `andEffects`, and `preventEffects` has no attacker filter.
 *  - sv08-045 Walrein: Frigid Fangs locks "Pokémon that have 2 or less Energy attached" (including new ones); `cantAttack` has
 *    no filter on how much Energy a Pokémon has (only `preventDamage.attackerMaxEnergy`).
 *  - sv08-069 Miraidon: C.O.D.E.: Protect protects "Future Pokémon"; the Ancient/Future tags are being built.
 */
import type { CardScript, Cond, Filter } from '../../dsl.js';
import { damageOneOf } from './helpers.js';
import './std-c24-customs.js'; // c24.*
import './std-c06-customs.js'; // c06.attachSplit
import './std-seed1-customs.js'; // std.discardStadium, std.revealHand
import './std-seed2-customs.js'; // seed2.energyToHand

/** "If you have any Tera Pokémon in play" (the card's own `fix.tera` marks Tera Pokémon). */
const TERA_IN_PLAY: Cond = { gte: [{ pokemon: { zone: 'myPokemon', filter: { tera: true } } }, 1] };
const ITEM_OR_TOOL: Filter = { any: [{ ttype: 'item' }, { ttype: 'tool' }] };

export const STD_C24: CardScript[] = [
  {
    id: 'sv08-020',
    name: 'Castform Sunny Form',
    attacks: {
      // "Your opponent's Active Pokémon is now Burned."
      Singe: { post: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
      // "Move all Energy from this Pokémon to 1 of your Benched Pokémon."
      'Sunny Assist': { post: [{ op: 'custom', fn: 'c24.moveAllEnergyToBench', args: { split: false } }] },
    },
  },
  {
    id: 'sv08-021',
    name: 'Victini',
    abilities: [
      {
        // "Attacks used by your Evolution {R} Pokémon do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
        // Ruling (Surging Sparks FAQ, TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2044/): setup-placed Skeledirge counts as an Evolution Pokémon for Victory Cheer. (put directly into play, not evolved)
        name: 'Victory Cheer',
        statics: [{ effect: { k: 'damageOut', amount: 10 }, scope: 'myPokemon', filter: { stage: 'evolution', type: 'Fire' } }],
      },
    ],
  },
  {
    id: 'sv08-025',
    name: 'Volcarona',
    attacks: {
      // "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."
      // The damage done is the change in the Defending Pokémon's damage counters (after Weakness, Resistance and every modifier).
      'Leech Life': {
        pre: [{ op: 'set', v: 'before', value: { countersOn: 'defender' } }],
        post: [{ op: 'heal', amount: { mul: [10, { max: [0, { sub: [{ countersOn: 'defender' }, { v: 'before' }] }] }] }, to: 'self' }],
      },
      // "This Pokémon also does 50 damage to itself."
      'Turbulent Wings': { post: [{ op: 'damage', amount: 50, to: 'self' }] },
    },
  },
  {
    id: 'sv08-031',
    name: 'Skeledirge',
    abilities: [
      {
        // "Prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)"
        // Ruling (Chaos Rising FAQ, TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2354/): attack effects are prevented; outcomes of effects chosen before prevention still happen. (Delibird, Pleasing Present: pinned in the test)
        name: 'Unaware',
        statics: [{ effect: { k: 'preventEffects', from: ['attack'] }, scope: 'self' }],
      },
    ],
    attacks: {
      // "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's)."
      Torcherto: {
        damage: { add: [60, { mul: [20, { add: [{ pokemon: { zone: 'myBench' } }, { pokemon: { zone: 'oppBench' } }] }] }] },
      },
    },
  },
  {
    id: 'sv08-034',
    name: 'Armarouge',
    attacks: {
      // "Discard all {R} Energy from this Pokémon, and this attack does 180 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (Surging Sparks FAQ, TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2050/): Energy is discarded even if no valid target exists. (no Benched Pokémon: the {R} Energy is still discarded)
      'Crimson Blaster': {
        program: [
          { op: 'discardEnergy', from: 'self', count: 'all', filter: { providesType: 'Fire' } },
          { op: 'if', cond: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }, then: damageOneOf('oppBench', 180) },
        ],
      },
    },
  },
  {
    id: 'sv08-035',
    name: 'Ceruledge',
    attacks: {
      // "Discard all Special Energy from all of your opponent's Pokémon."
      // Ruling (TPCi Rules Team 2024-11-14, https://compendium.pokegym.net/ruling/2085/): disabled Special Energy still counts as Special Energy. (the custom looks at the card, never at its text)
      'Cursed Edge': { post: [{ op: 'custom', fn: 'c24.discardSpecialEnergyAllOpp' }] },
      // "During your next turn, this Pokémon can't attack."
      'Black Blaze Slash': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv08-036',
    name: 'Ceruledge ex',
    attacks: {
      // "This attack does 20 more damage for each Energy card in your discard pile."
      'Abyssal Flames': { damage: { add: [30, { mul: [20, { count: { zone: 'discard', filter: { cat: 'energy' } } }] }] } },
      // "Discard all Energy from this Pokémon."
      'Raging Amethyst': { post: [{ op: 'discardEnergy', from: 'self', count: 'all' }] },
    },
  },
  {
    id: 'sv08-037',
    name: 'Scovillain ex',
    abilities: [
      {
        // "As long as this Pokémon is in play, it is {G} and {R} type."
        // Weakness and Resistance (as the attacker) and type filters see both types; see StaticEffect `types`.
        name: 'Double Type',
        statics: [{ effect: { k: 'types', types: ['Grass', 'Fire'] }, scope: 'self' }],
      },
    ],
    attacks: {
      // "This attack does 70 more damage for each damage counter on this Pokémon."
      'Spicy Rage': { damage: { add: [10, { mul: [70, { countersOn: 'self' }] }] } },
    },
  },
  {
    id: 'sv08-038',
    name: 'Gouging Fire',
    attacks: {
      // "If your opponent has 4 or fewer Prize cards remaining, this attack does 70 more damage."
      'Blazing Charge': { damage: { add: [100, { cond: { lte: [{ prizesLeft: 'opp' }, 4] }, then: 70, else: 0 }] } },
    },
  },
  {
    id: 'sv08-039',
    name: 'Paldean Tauros',
    attacks: {
      // "You may put 2 Energy attached to your opponent's Active Stage 2 Pokémon into their hand."
      'Upthrusting Horns': {
        post: [
          {
            op: 'if',
            cond: { slotIs: { ref: 'oppActive', filter: { stage: 'stage2' } } },
            then: [{ op: 'may', body: [{ op: 'custom', fn: 'c24.oppActiveEnergyToHand', args: { n: 2 } }] }],
          },
        ],
      },
    },
  },
  {
    id: 'sv08-041',
    name: 'Feebas',
    attacks: {
      // "Switch this Pokémon with 1 of your Benched Pokémon."
      'Leap Out': { post: [{ op: 'switch', who: 'self' }] },
    },
  },
  {
    id: 'sv08-048',
    name: 'Black Kyurem ex',
    attacks: {
      // "If your opponent's Active Pokémon is a {N} Pokémon, it is now Paralyzed."
      'Ice Age': {
        post: [{ op: 'if', cond: { slotIs: { ref: 'oppActive', filter: { type: 'Dragon' } } }, then: [{ op: 'condition', cond: 'paralyzed', to: 'oppActive' }] }],
      },
      // "This Pokémon also does 30 damage to itself."
      'Black Frost': { post: [{ op: 'damage', amount: 30, to: 'self' }] },
    },
  },
  {
    id: 'sv08-049',
    name: 'Bruxish',
    abilities: [
      {
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon."
        // The Attacking Pokémon is the opponent's Active Pokémon.
        name: 'Counterattack',
        triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'counters', n: 3, to: 'oppActive' }] }],
      },
    ],
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Big Bite': { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv08-052',
    name: 'Quaquaval',
    abilities: [
      {
        // "You must put a card from your hand on the bottom of your deck in order to use this Ability. Once during your turn, you may draw cards until you have 5 cards in your hand."
        // Ruling (Surging Sparks FAQ, TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2042/): you must be able to draw when using this Ability. (6 or more cards in hand)
        // So the Ability needs a card to put back (1 or more in hand), 5 or fewer cards in hand (putting one back leaves room to draw) and a card in the deck to draw.
        name: 'Up-Tempo',
        activated: {
          when: { and: [{ gte: [{ handSize: 'self' }, 1] }, { lte: [{ handSize: 'self' }, 5] }, { gte: [{ deckSize: 'self' }, 1] }] },
          program: [
            { op: 'chooseCards', from: 'hand', min: 1, max: 1, as: 'back', prompt: 'Put a card from your hand on the bottom of your deck' },
            { op: 'move', cards: 'back', to: 'deckBottom' },
            { op: 'draw', n: { max: [0, { sub: [5, { handSize: 'self' }] }] } },
          ],
        },
      },
    ],
  },
  {
    id: 'sv08-054',
    name: 'Cetitan',
    abilities: [
      {
        // "This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
        name: 'Solid Body',
        statics: [{ effect: { k: 'damageIn', amount: -30 }, scope: 'self' }],
      },
    ],
  },
  {
    id: 'sv08-056',
    name: 'Chien-Pao',
    abilities: [
      {
        // "When you play this Pokémon from your hand onto your Bench during your turn, you may discard a Stadium in play."
        name: 'Snow Sink',
        triggers: [{ on: 'playToBench', optional: true, when: { stadium: true }, program: [{ op: 'custom', fn: 'std.discardStadium' }] }],
      },
    ],
    attacks: {
      // "Put an Energy attached to this Pokémon into your hand."
      'Icicle Loop': { post: [{ op: 'custom', fn: 'seed2.energyToHand' }] },
    },
  },
  {
    id: 'sv08-059',
    name: 'Magneton',
    abilities: [
      {
        // "Once during your turn, you may attach up to 3 Basic Energy cards from your discard pile to your {L} Pokémon in any way you like. If you use this Ability, this Pokémon is Knocked Out."
        // An Ability's "up to" is 1 to 3 (TPCi 2026-02-19), so it needs a Basic Energy card in the discard pile.
        name: 'Overvolt Discharge',
        activated: {
          when: { gte: [{ count: { zone: 'discard', filter: { basicEnergy: true } } }, 1] },
          program: [
            { op: 'chooseCards', from: 'discard', filter: { basicEnergy: true }, min: 1, max: 3, as: 'e', prompt: 'Attach up to 3 Basic Energy cards' },
            { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myPokemon', filter: { type: 'Lightning' } } },
            { op: 'knockOut', target: 'self' },
          ],
        },
      },
    ],
  },
  {
    id: 'sv08-061',
    name: 'Rotom',
    attacks: {
      // "Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there."
      // Ruling (Surging Sparks FAQ, TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2051/): all matching cards must be discarded.
      'Crushing Pulse': {
        program: [
          { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
          { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'self', filter: ITEM_OR_TOOL, min: 60, max: 60, as: 'found', prompt: "Discard all Item and Pokémon Tool cards in your opponent's hand" },
          { op: 'move', cards: 'found', to: 'discard', who: 'opp' },
        ],
      },
      // "This attack does 20 damage for each Energy attached to your opponent's Active Pokémon."
      'Energy Short': { damage: { mul: [20, { energyOn: 'oppActive' }] } },
    },
  },
  {
    id: 'sv08-064',
    name: 'Stunfisk',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon."
      // Ruling (Surging Sparks FAQ, TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2058/): one flip applies to all effects; tails prevents everything. (tails: neither)
      'Paralyzing Crackle': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [
              { op: 'condition', cond: 'paralyzed', to: 'oppActive' },
              { op: 'discardEnergy', from: 'oppActive', count: 1 },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv08-067',
    name: 'Kilowattrel',
    attacks: {
      // "Move all Energy from this Pokémon to your Benched Pokémon in any way you like."
      'Storm Bolt': { post: [{ op: 'custom', fn: 'c24.moveAllEnergyToBench', args: { split: true } }] },
    },
  },
  {
    id: 'sv08-068',
    name: 'Kilowattrel ex',
    attacks: {
      // "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon."
      'Return Charge': {
        post: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [
              { op: 'switch', who: 'self' },
              { op: 'chooseCards', from: 'hand', filter: { energyType: 'Lightning' }, min: 0, max: 2, as: 'e', prompt: 'Attach up to 2 Basic {L} Energy cards' },
              { op: 'attach', cards: 'e', to: 'self' },
            ],
          },
        ],
      },
      // "This attack does 40 more damage for each {L} Energy attached to this Pokémon."
      'Thunder Lance': { damage: { add: [40, { mul: [40, { energyOn: 'self', type: 'Lightning' }] }] } },
    },
  },
  {
    id: 'sv08-074',
    name: 'Azumarill',
    abilities: [
      {
        // "If you have any Tera Pokémon in play, this Pokémon can use the Double-Edge attack for {P}."
        name: 'Glistening Bubbles',
        statics: [{ effect: { k: 'attackCostSet', attack: 'Double-Edge', cost: ['Psychic'] }, scope: 'self', when: TERA_IN_PLAY }],
      },
    ],
    attacks: {
      // "This Pokémon also does 50 damage to itself."
      'Double-Edge': { post: [{ op: 'damage', amount: 50, to: 'self' }] },
    },
  },
];
