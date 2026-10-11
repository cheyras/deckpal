/**
 * Standard batch c15: Scarlet & Violet Fighting, Darkness, Metal, Dragon and Colorless Pokémon and Trainers (sv05).
 * Written from the printed text in frames.ts; quotes below are that text. One test per card in
 * src/__tests__/cards-std-c15.test.ts.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - sv05-099 Iron Boulder ex, Repulsor Axe: "During your opponent's next turn, if this Pokémon is damaged by an attack (even
 *    if it is Knocked Out), put 8 damage counters on the Attacking Pokémon." -- a timed effect that reacts to being damaged.
 *  - sv05-109 Roaring Moon, Vengeance Fletching ("for each Ancient card in your discard pile"), sv05-119 Koraidon, Primordial
 *    Beatdown ("each of your Ancient Pokémon in play") and sv05-141 Awakening Drum ("each of your Ancient Pokémon in play"):
 *    no Ancient tag in the filter vocabulary.
 *  - sv05-118 Iron Treads, Dual Core ("it is {F} and {M} type" while a Future Booster Energy Capsule is attached): extra types on
 *    a Pokémon.
 *  - sv05-121 Miraidon, Peak Acceleration ("attach them to your Future Pokémon"): no Future tag in the filter vocabulary.
 */
import type { Cond, CardScript } from '../../dsl.js';
import { damageOneOf, searchToHand } from './helpers.js';
import './std-c04-customs.js'; // c04.pickEnergyOnSelf
import './std-c06-customs.js'; // c06.rememberAttack, c06.usedLastTurn
import './std-c09-customs.js'; // c09.endTurn
import './std-c12-customs.js'; // c12.remainingHpAtMost
import './std-c15-customs.js';
import './std-seed1-customs.js'; // std.revealHand
import './std-seed2-customs.js'; // seed2.sumAttached
import './std-seed4-customs.js'; // seed4.discardPicked

/** Metagross: "During your next turn, this Pokémon's Meteor Mash attack does 60 more damage": the mark Meteor Mash leaves. */
const METEOR_LAST_TURN: Cond = { custom: 'c06.usedLastTurn', args: { attack: 'Meteor Mash' } };

export const STD_C15: CardScript[] = [
  {
    id: 'sv05-098',
    name: 'Sandy Shocks',
    attacks: {
      // "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness."
      // (Energy in play = Energy attached to all of your Pokémon, counted in units provided as "each Energy" is elsewhere.)
      'Magnetic Burst': {
        pre: [{ op: 'custom', fn: 'seed2.sumAttached', args: { kind: 'energy', zone: 'myPokemon', as: 'n' } }],
        damage: { add: [20, { cond: { gte: [{ v: 'n' }, 3] }, then: 70, else: 0 }] },
        ignore: { weakness: true },
      },
    },
  },
  {
    id: 'sv05-100',
    name: 'Ekans',
    attacks: {
      // "Flip a coin. If heads, your opponent's Active Pokémon is now Confused and Poisoned."
      'Poison Blend': {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          {
            op: 'if',
            cond: { gte: [{ v: 'h' }, 1] },
            then: [
              { op: 'condition', cond: 'confused', to: 'oppActive' },
              { op: 'condition', cond: 'poisoned', to: 'oppActive' },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv05-101',
    name: 'Arbok',
    attacks: {
      // "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."
      'Panic Poison': {
        program: [
          { op: 'condition', cond: 'burned', to: 'oppActive' },
          { op: 'condition', cond: 'confused', to: 'oppActive' },
          { op: 'condition', cond: 'poisoned', to: 'oppActive' },
        ],
      },
    },
  },
  {
    id: 'sv05-107',
    name: 'Sableye',
    attacks: {
      // "You may move any number of damage counters from your opponent's Benched Pokémon to their Active Pokémon."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1955/): "You can choose as many Benched Pokemon as you like, but all of the damage gets moved to the opponent's Active Pokemon."
      'Damage Collection': { program: [{ op: 'may', body: [{ op: 'custom', fn: 'c15.collectCounters' }] }] },
    },
    notes:
      'Compendium #1955 (a ruling on this attack): any number of Benched Pokémon may give counters, all of them land on the Active Pokémon. ' +
      'Read as: for each damaged Benched Pokémon the player says how many of its counters to move (none to all). The Sableye\'s other-attack rulings (Lost Mine, Bewitching Eyes ...) are about other cards.',
  },
  {
    id: 'sv05-108',
    name: 'Farigiraf ex',
    abilities: [
      {
        // "Prevent all damage done to this Pokémon by attacks from your opponent's Basic Pokémon ex."
        name: 'Armor Tail',
        statics: [{ effect: { k: 'preventDamage', attacker: { stage: 'basic', ex: true } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Dirty Beam': { post: damageOneOf('oppBench', 30) },
    },
  },
  {
    id: 'sv05-111',
    name: 'Scizor ex',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance)."
      'Steel Wing': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -50 }, on: 'self', duration: 'oppNextTurn' }] },
      // "Discard up to 2 {M} Energy from this Pokémon. This attack does 120 damage for each card you discarded in this way."
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2423/), Raging Bolt ex's identically worded Bellowing Thunder: "Bellowing Thunder does damage first, and then the energy is discarded."
      // -- the cards are chosen first (that sets the damage), the damage is done, and only then are they discarded.
      'Cross Breaker': {
        pre: [{ op: 'custom', fn: 'c04.pickEnergyOnSelf', args: { n: 2, filter: { providesType: 'Metal' }, as: 'd' } }],
        damage: { mul: [120, { len: 'd' }] },
        post: [{ op: 'custom', fn: 'seed4.discardPicked', args: { cards: 'd' } }],
      },
    },
    notes: 'Cross Breaker discards after damage by analogy with the identically worded Bellowing Thunder (#2423); no ruling names Cross Breaker itself. "{M} Energy" is any Energy providing {M}, Basic or Special.',
  },
  {
    id: 'sv05-115',
    name: 'Metagross',
    attacks: {
      // "During your next turn, this Pokémon's Meteor Mash attack does 60 more damage (before applying Weakness and Resistance)."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/518/): "No, Meteor Mash tops out at 120. It only adds +60 to the base 60 damage, it does not accumulate on successive turns."
      // -- the attack leaves a mark on this Pokémon through the end of your next turn; the bonus is "+60 if the mark is there",
      // checked before the new mark is written, so it is 60, then 120, then 120 ....
      'Meteor Mash': {
        damage: { add: [60, { cond: METEOR_LAST_TURN, then: 60, else: 0 }] },
        post: [{ op: 'custom', fn: 'c06.rememberAttack', args: { attack: 'Meteor Mash' } }],
      },
      // "Discard 2 Energy from this Pokémon."
      'Luster Blast': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
    notes:
      'Compendium #518: the bonus never accumulates (60, then 120 at most). The "+60 next turn" is a mark on this Pokémon (c06.rememberAttack) kept through the end of your next turn, ' +
      'so it also survives this Pokémon moving to the Bench and back; no ruling covers that.',
  },
  {
    id: 'sv05-120',
    name: 'Koraidon ex',
    attacks: {
      // "This attack does 10 more damage for each damage counter on this Pokémon."
      'Retribution Strike': { damage: { add: [20, { mul: [10, { countersOn: 'self' }] }] } },
      // "This Pokémon also does 60 damage to itself."
      'Kaiser Tackle': { post: [{ op: 'damage', amount: 60, to: 'self' }] },
    },
  },
  {
    id: 'sv05-122',
    name: 'Miraidon ex',
    attacks: {
      // "If your opponent's Active Pokémon already has any damage counters on it, this attack does 100 more damage."
      'Repulsion Bolt': {
        damage: { add: [60, { cond: { slotIs: { ref: 'oppActive', filter: { damaged: true } } }, then: 100, else: 0 }] },
      },
      // "During your next turn, this Pokémon can't use Cyber Drive."
      'Cyber Drive': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Cyber Drive' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv05-124',
    name: 'Lickitung',
    attacks: {
      // "Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your opponent's Bench."
      'Tongue Pull': {
        program: [
          { op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } },
          {
            op: 'chooseCards',
            from: 'hand',
            who: 'opp',
            chooser: 'self',
            filter: { cat: 'pokemon', stage: 'basic' },
            min: 0,
            max: { min: [2, { sub: [5, { pokemon: { zone: 'oppBench' } }] }] },
            as: 'x',
            reveal: true,
            prompt: "Choose up to 2 Basic Pokémon in your opponent's hand",
          },
          { op: 'move', cards: 'x', to: 'bench', who: 'opp' },
        ],
      },
    },
  },
  {
    id: 'sv05-127',
    name: 'Noctowl',
    attacks: {
      // "You may search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck."
      'Talon Hunt': { post: [{ op: 'may', body: searchToHand({}, 2, { reveal: false }) }] },
    },
  },
  {
    id: 'sv05-131',
    name: 'Delcatty',
    attacks: {
      // "Your opponent's Active Pokémon is now Confused."
      'Tail Trickery': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
      // "You may move any amount of Energy from your Pokémon to your other Pokémon in any way you like."
      'Energy Blender': { post: [{ op: 'may', body: [{ op: 'custom', fn: 'c15.moveEnergyAny' }] }] },
    },
  },
  {
    id: 'sv05-133',
    name: 'Pidove',
    abilities: [
      {
        // "Once during your turn, if this Pokémon's remaining HP is 30 or less, you may search your deck for an Unfezant or Unfezant ex
        //  and put it onto this Pidove to evolve it. Then, shuffle your deck."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1949/): "Yes, as long as its remaining HP is 30 or less." (during your first turn or the turn it was put into play)
        name: 'Emergency Evolution',
        activated: {
          program: [{ op: 'custom', fn: 'c15.evolveSelfFromDeck', args: { names: ['Unfezant', 'Unfezant ex'] } }, { op: 'shuffle' }],
          when: {
            and: [
              { custom: 'c12.remainingHpAtMost', args: { n: 30 } },
              { gte: [{ count: { zone: 'deck', filter: { name: ['Unfezant', 'Unfezant ex'] } } }, 1] },
            ],
          },
        },
      },
    ],
    notes: 'Compendium #1949: usable on your first turn and the turn Pidove was played (the evolution rules do not apply; the card need not "evolve from" Pidove). The Ability is offered only when the deck holds an Unfezant or Unfezant ex.',
  },
  {
    id: 'sv05-136',
    name: 'Minccino',
    attacks: {
      // "Discard up to 2 Pokémon Tools from your opponent's Pokémon."
      'Cleaning Up': { program: [{ op: 'custom', fn: 'c15.discardOppTools', args: { max: 2 } }] },
    },
  },
  {
    id: 'sv05-137',
    name: 'Cinccino',
    attacks: {
      // "This attack does 70 damage for each Special Energy card attached to this Pokémon."
      'Special Roll': {
        pre: [{ op: 'custom', fn: 'c15.countAttached', args: { filter: { cat: 'energy', basicEnergy: false }, as: 'n' } }],
        damage: { mul: [70, { v: 'n' }] },
      },
    },
  },
  {
    id: 'sv05-138',
    name: 'Drampa',
    attacks: {
      // "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage."
      // (Compendium #348, on Drampa GX's "any" wording, says "all"/"each" would have required every Benched Pokémon.)
      'Raging Cannon': {
        damage: {
          add: [
            100,
            {
              cond: { gte: [{ pokemon: { zone: 'myBench', filter: { damaged: true } } }, { pokemon: { zone: 'myBench' } }] },
              then: 120,
              else: 0,
            },
          ],
        },
      },
    },
    status: 'needs_ruling',
    notes:
      'Open question: with NO Benched Pokémon, is "all of your Benched Pokémon have at least 1 damage counter" true? Scripted literally (vacuously true: the bonus applies). ' +
      'Compendium #348 (Drampa GX Berserk) only settles that "all" means every Benched Pokémon.',
  },
  {
    id: 'sv05-139',
    name: 'Iron Jugulis',
    abilities: [
      {
        // "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon."
        // The Attacking Pokémon is the opponent's Active Pokémon.
        name: 'Automated Combat',
        triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'counters', n: 3, to: 'oppActive' }] }],
      },
    ],
  },
  {
    id: 'sv05-142',
    name: "Bianca's Devotion",
    // "Heal all damage from 1 of your Pokémon that has 30 HP or less remaining."
    // (No effect, no play: a damaged Pokémon with 30 HP or less remaining must exist.)
    playable: { custom: 'c15.lowHpDamaged' },
    play: [{ op: 'custom', fn: 'c15.healLowHp' }],
  },
  {
    id: 'sv05-143',
    name: 'Boxed Order',
    // "Search your deck for up to 2 Item cards, reveal them, and put them into your hand. Then, shuffle your deck. Your turn ends."
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1963/): "Yes, it does." (the turn ends even if no Item cards are found)
    play: [...searchToHand({ ttype: 'item' }, 2, { min: 1 }), { op: 'custom', fn: 'c09.endTurn' }],
  },
];
