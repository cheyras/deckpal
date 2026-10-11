/**
 * Batch "std-30c": 30th Celebration cards (Fighting, Darkness and Metal sections), scripted from the printed text.
 *
 * Skipped (the engine cannot say them; frames not added):
 *  - 30th-084 Seismitoad, Quaking Fist: "whenever they try to use a Trainer card from their hand, they flip a coin. If tails, your opponent
 *    discards that Trainer card instead of using it" needs a lasting effect that intercepts a Trainer being played (no such static or play hook).
 *  - 30th-100 Yveltal, Life-Locked: "Your opponent's Active Pokémon can't be healed" needs a static that stops healing (no such StaticEffect).
 */
import type { CardScript, Cond, Expr, Program } from '../../dsl.js';
import { damageOneOf } from './helpers.js';
import './std-c29-customs.js'; // c29.attackingPokemon (Fainting Spell)
import './std-seed1-customs.js'; // std.attackKoLastTurn (Retaliate), std.discardOppActiveTools (Fend Off)

const moreIf = (cond: Cond, n: number): Expr => ({ cond, then: n, else: 0 });

/** "Flip a coin. If heads, <body>" */
const ifHeads = (body: Program): Program => [
  { op: 'flip', n: 1, as: 'h' },
  { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: body },
];

export const STD_30C: CardScript[] = [
  // ---------------------------------------------------------------- Fighting
  {
    id: '30th-082',
    name: 'Groudon',
    attacks: {
      // "This attack also does 20 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Break Ground': { post: [{ op: 'damage', amount: 20, to: { each: 'myBench' } }] },
    },
  },
  {
    id: '30th-083',
    name: 'Lucario',
    attacks: {
      // "This attack also does 60 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Aura Sphere': { post: damageOneOf('oppBench', 60) },
    },
  },
  {
    id: '30th-085',
    name: 'Lycanroc',
    attacks: {
      // "If this Pokémon was damaged by an attack during your opponent's last turn, this attack does that much more damage."
      // Ruling (TPCi Rules Team 2020-05-07, https://compendium.pokegym.net/ruling/384/): "It doesn't matter where Cinderace VMAX was when it was damaged during your opponent's last turn, nor whether it has switched in or out of the Active Slot." (same wording as Counter)
      Counter: { damage: { add: [10, { damageTakenLastTurn: 'self' }] } },
    },
  },
  {
    id: '30th-086',
    name: 'Koraidon',
    attacks: {
      // "Discard 2 {F} Energy from this Pokémon."
      'Collision Course': { post: [{ op: 'discardEnergy', from: 'self', count: 2, filter: { providesType: 'Fighting' } }] },
    },
  },

  // ---------------------------------------------------------------- Darkness
  {
    id: '30th-087',
    name: 'Nidoran♀',
    attacks: {
      // "During your opponent's next turn, attacks used by the Defending Pokémon do 30 less damage (before applying Weakness and Resistance)."
      Growl: { program: [{ op: 'effect', static: { k: 'damageOut', amount: -30 }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: '30th-088',
    name: 'Nidorina',
    abilities: [
      {
        // "Once during your turn, you may use this Ability. Heal 30 damage from 1 of your Pokémon."
        // Not offered when none of your Pokémon is damaged (it would do nothing).
        name: 'Share Happiness',
        activated: {
          when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] },
          program: [
            { op: 'chooseSlots', from: 'myPokemon', filter: { damaged: true }, min: 1, max: 1, as: 't', prompt: 'Heal 30 damage from which Pokémon?' },
            { op: 'heal', amount: 30, to: { v: 't' } },
          ],
        },
      },
    ],
  },
  {
    id: '30th-089',
    name: 'Alolan Meowth',
    attacks: {
      // "Draw a card."
      'Pay Day': { post: [{ op: 'draw', n: 1 }] },
    },
  },
  {
    id: '30th-090',
    name: 'Gengar ex',
    abilities: [
      {
        // "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, flip a coin. If heads, the Attacking Pokémon is Knocked Out."
        // Ruling (TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2106/): the Attacking Pokémon must still be in play (empty variable otherwise).
        name: 'Fainting Spell',
        triggers: [
          {
            on: 'knockedOutByAttack',
            program: ifHeads([
              { op: 'custom', fn: 'c29.attackingPokemon', args: { as: 'a' } },
              { op: 'if', cond: { gte: [{ len: 'a' }, 1] }, then: [{ op: 'knockOut', target: { v: 'a' } }] },
            ]),
          },
        ],
      },
    ],
    attacks: {
      // "Place 13 damage counters on 1 of your opponent's Pokémon."
      'Chaotic Pain': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't', prompt: 'Place 13 damage counters on which Pokémon?' },
          { op: 'counters', n: 13, to: { v: 't' } },
        ],
      },
    },
  },
  {
    id: '30th-091',
    name: 'Umbreon',
    attacks: {
      // "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage."
      // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2200/): "Yes, you would. Even though the Pokemon with Legacy Energy attached does not give up a prize card, it still counts as a KO'd Pokemon." (same wording as Retaliate)
      Retaliate: { damage: { add: [30, moreIf({ custom: 'std.attackKoLastTurn' }, 100)] } },
    },
  },
  {
    id: '30th-092',
    name: 'Umbreon ex',
    attacks: {
      // "If your opponent's Active Pokémon already has any damage counters on it, this attack does 140 more damage."
      'Lunatic Claw': { damage: { add: [100, moreIf({ slotIs: { ref: 'defender', filter: { damaged: true } } }, 140)] } },
    },
  },
  {
    id: '30th-093',
    name: 'Murkrow',
    attacks: {
      // "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't retreat."
      'Clumsily Clutch': { post: ifHeads([{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }]) },
    },
  },
  {
    id: '30th-094',
    name: 'Scraggy',
    attacks: {
      // "Your opponent shuffles their hand into their deck and draws 4 cards."
      Nitpick: {
        program: [
          { op: 'move', cards: { all: 'hand', who: 'opp' }, to: 'deck', who: 'opp' },
          { op: 'shuffle', who: 'opp' },
          { op: 'draw', n: 4, who: 'opp' },
        ],
      },
    },
  },
  {
    id: '30th-096',
    name: 'Zoroark',
    abilities: [
      {
        // "As long as this Pokémon is on your Bench, your Active Pokémon's Retreat Cost is {C}{C} less."
        name: 'Nighttime Byway',
        statics: [{ effect: { k: 'retreatCost', delta: -2 }, scope: 'myActive', when: { onBench: 'self' } }],
      },
    ],
  },
  {
    id: '30th-099',
    name: 'Hydreigon',
    attacks: {
      // "Flip 3 coins. For each heads, discard an Energy from your opponent's Active Pokémon."
      'Three-Headed Bite': {
        program: [
          { op: 'flip', n: 3, as: 'h' },
          { op: 'if', cond: { gte: [{ v: 'h' }, 1] }, then: [{ op: 'discardEnergy', from: 'defender', count: { v: 'h' } }] },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- Metal
  {
    id: '30th-101',
    name: 'Galarian Meowth',
    attacks: {
      // "Draw a card."
      'Pay Day': { post: [{ op: 'draw', n: 1 }] },
      // "This attack does 10 damage for each card in your hand."
      'Treasure Rush': { damage: { mul: [10, { handSize: 'self' }] } },
    },
  },
  {
    id: '30th-102',
    name: 'Jirachi ex',
    attacks: {
      // "Draw cards until you have 7 cards in your hand."
      'Wish Granter': { program: [{ op: 'draw', n: { max: [0, { sub: [7, { handSize: 'self' }] }] } }] },
      // "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon."
      Swift: { ignore: { weakness: true, resistance: true, defenderEffects: true } },
    },
  },
  {
    id: '30th-103',
    name: 'Dialga',
    attacks: {
      // "Shuffle up to 3 in any combination of Pokémon and Basic Energy cards from your discard pile into your deck."
      'Reversed Clock': {
        program: [
          {
            op: 'chooseCards',
            from: 'discard',
            filter: { any: [{ cat: 'pokemon' }, { basicEnergy: true }] },
            min: 0,
            max: 3,
            as: 'x',
            prompt: 'Shuffle up to 3 Pokémon and Basic Energy cards into your deck',
          },
          { op: 'move', cards: 'x', to: 'deck' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: '30th-104',
    name: 'Ferrothorn',
    attacks: {
      // "This attack does 50 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) This Pokémon also does 130 damage to itself."
      'Kaboom Needles': {
        program: [
          { op: 'damage', amount: 50, to: { each: 'oppPokemon' } },
          { op: 'damage', amount: 130, to: 'self' },
        ],
      },
    },
  },
  {
    id: '30th-105',
    name: 'Solgaleo',
    abilities: [
      {
        // "Once during your turn, if this Pokémon is on your Bench, you may use this Ability. Search your deck for up to 2 Basic Metal Energy cards and attach them to this Pokémon. Then, shuffle your deck."
        // An Ability's "up to" is 1 to 2 (TPCi Rules Team 2026-02-19: only attacks can choose zero); a deck search may still find nothing.
        name: 'Sunrise',
        activated: {
          when: { and: [{ onBench: 'self' }, { gte: [{ deckSize: 'self' }, 1] }] },
          program: [
            { op: 'chooseCards', from: 'deck', filter: { energyType: 'Metal' }, min: 1, max: 2, as: 'e', prompt: 'Attach up to 2 Basic {M} Energy cards to this Pokémon' },
            { op: 'attach', cards: 'e', to: 'self' },
            { op: 'shuffle' },
          ],
        },
      },
    ],
    attacks: {
      // "Discard all Energy from this Pokémon."
      'Sunsteel Strike': { post: [{ op: 'discardEnergy', from: 'self', count: 'all' }] },
    },
  },
  {
    id: '30th-106',
    name: 'Zacian',
    attacks: {
      // "If this Pokémon has a Pokémon Tool attached, this attack does 40 more damage."
      'Hardened Blade': { damage: { add: [20, moreIf({ slotIs: { ref: 'self', filter: { tool: true } } }, 40)] } },
      // "During your next turn, this Pokémon can't use Slashing Strike."
      'Slashing Strike': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Slashing Strike' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: '30th-107',
    name: 'Zamazenta',
    attacks: {
      // "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."
      'Fend Off': { pre: [{ op: 'custom', fn: 'std.discardOppActiveTools' }] },
      // "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance)."
      'Shield Press': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -50, fromOpp: true }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
];
