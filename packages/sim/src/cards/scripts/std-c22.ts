/**
 * Standard batch c22: Surging Sparks (sv07) Pokémon 061-120 whose text no earlier script covered. Each script is written from
 * the printed text in frames; quotes below are that text.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - sv07-076 Rhyperior: Wide Wall ("whenever your opponent plays a Supporter card from their hand, prevent all effects of that
 *    card done to all of your Pokémon") needs prevention of the effects of Supporter cards; `preventEffects` only covers
 *    attacks and Abilities.
 *  - sv07-101 Klinklang: Emergency Rotation ("Once during your turn, if this Pokémon is in your hand and your opponent has
 *    any Stage 2 Pokémon in play, you may put this Pokémon onto your Bench") is an Ability used from the hand; Abilities
 *    here are only activated from play.
 *  - sv07-110 Orthworm ex: Pummeling Payback ("If this Pokémon is damaged by an attack from your opponent's Pokémon (even if this
 *    Pokémon is Knocked Out)") works wherever the Pokémon is; the `damagedByAttackActive` trigger fires only while it is in
 *    the Active Spot, so a Benched Orthworm ex damaged by an attack would silently not trigger.
 */
import type { CardScript, Cond, Filter } from '../../dsl.js';
import { searchToBench, searchToHand } from './helpers.js';
import './misc-customs.js'; // countersUntilHp
import './std-c06-customs.js'; // c06.rememberAttack, c06.usedLastTurn
import './std-c22-customs.js';

/** "Flip a coin. If heads, ..." */
const HEADS: Cond = { gte: [{ v: 'h' }, 1] };

const DRIFS: Filter = { name: ['Drifloon', 'Drifblim'] };

/** "Used Form Ranks during your last turn": the marker Form Ranks leaves on the Pokémon (c06.rememberAttack). */
const FORM_RANKS_LAST_TURN: Cond = { custom: 'c06.usedLastTurn', args: { attack: 'Form Ranks' } };

export const STD_C22: CardScript[] = [
  {
    id: 'sv07-061',
    name: 'Drifblim',
    attacks: {
      // "This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your
      //  Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2021/): only the final evolution counts; prior stages are part of it.
      // (Only the top card of each Pokémon counts and is damaged; this Drifblim is one of "each of your Drifloon and Drifblim".)
      'Everyone Explode Now': {
        damage: { mul: [50, { pokemon: { zone: 'myPokemon', filter: DRIFS } }] },
        post: [{ op: 'damage', amount: 30, to: { each: 'myPokemon', filter: DRIFS } }],
      },
    },
  },
  {
    id: 'sv07-063',
    name: 'Comfey',
    attacks: {
      // "Each player draws 3 cards."
      'Flower Shower': {
        program: [
          { op: 'draw', n: 3 },
          { op: 'draw', n: 3, who: 'opp' },
        ],
      },
      // "Flip a coin. If heads, this attack does 20 more damage."
      'Play Rough': {
        pre: [{ op: 'flip', n: 1, as: 'h' }],
        damage: { add: [20, { cond: HEADS, then: 20, else: 0 }] },
      },
    },
  },
  {
    id: 'sv07-065',
    name: 'Alcremie',
    attacks: {
      // "Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."
      // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2020/): no, Luminous Energy isn't basic despite providing all types.
      // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2019/): search multiple types if they match attached energy types.
      'Colorful Confection': {
        program: [
          { op: 'custom', fn: 'c22.searchAttachedTypes', args: { max: 5, as: 'found' } },
          { op: 'move', cards: 'found', to: 'hand' },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv07-067',
    name: 'Dachsbun ex',
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may heal all damage from each of your Evolution Pokémon. If you healed any damage in this way, discard all Energy from those Pokémon."
        // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2016/): yes. (the Dachsbun ex that just evolved is healed too)
        // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2015/): you choose; if yes, heal all evolutions and discard their energy.
        // Offered only while one of your Evolution Pokémon has damage on it (a use that heals nothing does nothing).
        name: 'Time to Chow Down',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { stage: 'evolution', damaged: true } } }, 1] },
            program: [{ op: 'custom', fn: 'c22.healEvolutions' }],
          },
        ],
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Confused."
      'Wonder Shine': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv07-071',
    name: 'Iron Boulder',
    attacks: {
      // "If you don't have the same number of cards in your hand as your opponent, this attack does nothing."
      'Adjusted Horn': {
        program: [{ op: 'if', cond: { eq: [{ handSize: 'self' }, { handSize: 'opp' }] }, then: [{ op: 'damage', amount: 170 }] }],
      },
    },
  },
  {
    id: 'sv07-073',
    name: 'Marowak',
    attacks: {
      // "During your opponent's next turn, attacks used by the Defending Pokémon do 40 less damage (before applying Weakness and Resistance)."
      Growl: { program: [{ op: 'effect', static: { k: 'damageOut', amount: -40 }, on: 'defender', duration: 'oppNextTurn' }] },
      // "If any of your Benched Cubone have any damage counters on them, this attack does 120 more damage."
      'Bone Vengeance': {
        damage: {
          add: [60, { cond: { gte: [{ pokemon: { zone: 'myBench', filter: { name: 'Cubone', damaged: true } } }, 1] }, then: 120, else: 0 }],
        },
      },
    },
  },
  {
    id: 'sv07-075',
    name: 'Rhydon',
    attacks: {
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      'Destructive Horn': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: HEADS, then: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
        ],
      },
    },
  },
  {
    id: 'sv07-080',
    name: 'Medicham ex',
    attacks: {
      // "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50."
      'Chi-Atsu': {
        program: [
          { op: 'custom', fn: 'countersUntilHp', args: { hp: 50, as: 'n' } },
          { op: 'counters', n: { v: 'n' }, to: 'oppActive' },
        ],
      },
      // "This attack's damage isn't affected by Weakness or Resistance."
      'Yoga Kick': { ignore: { weakness: true, resistance: true } },
    },
  },
  {
    id: 'sv07-086',
    name: 'Diancie',
    attacks: {
      // "This attack does 40 damage for each Special Energy attached to all of your opponent's Pokémon."
      // Ruling (TPCi Rules Team 2024-09-05, https://compendium.pokegym.net/ruling/2010/): damage counts special energy cards, not total energy provided.
      'Diffuse Reflection': {
        pre: [{ op: 'custom', fn: 'c22.countAttachedIn', args: { zone: 'oppPokemon', filter: { cat: 'energy', basicEnergy: false }, as: 'n' } }],
        damage: { mul: [40, { v: 'n' }] },
      },
    },
  },
  {
    id: 'sv07-088',
    name: 'Falinks',
    attacks: {
      // "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
      // "If this Pokémon used Form Ranks during your last turn, ..." (the remembering half: the marker c06.rememberAttack leaves)
      'Form Ranks': {
        program: [...searchToBench({}, 2), { op: 'custom', fn: 'c06.rememberAttack', args: { attack: 'Form Ranks' } }],
      },
      // "If this Pokémon used Form Ranks during your last turn, this attack does 90 more damage."
      // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2017/): 120 damage; checks if attacked last turn, not a pokémon effect.
      // (Retreating Falinks and promoting it again keeps the bonus: the marker stays with the Pokémon.)
      'All-Out Attack': { damage: { add: [30, { cond: FORM_RANKS_LAST_TURN, then: 90, else: 0 }] } },
    },
  },
  {
    id: 'sv07-090',
    name: 'Koraidon',
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 70 more damage."
      'Resolute Fang': { damage: { add: [50, { cond: { slotIs: { ref: 'oppActive', filter: { ex: true } } }, then: 70, else: 0 }] } },
    },
  },
  {
    id: 'sv07-092',
    name: 'Swalot',
    attacks: {
      // "If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage."
      'Devouring Mouth': {
        damage: { add: [10, { cond: { gt: [{ energyOn: 'self' }, { energyOn: 'oppActive' }] }, then: 160, else: 0 }] },
      },
      // "Your opponent's Active Pokémon is now Poisoned."
      'Venomous Hit': { post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv07-096',
    name: 'Grimmsnarl',
    attacks: {
      // "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 160 damage to the new Active Pokémon."
      // Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2025/): no damage if no new active pokémon is switched in. (Mist Energy stops the switch: no damage.)
      // "If you do" = the Defending Pokémon is no longer Active after the switch (no Bench, or the switch was prevented, leaves it there).
      "Goad 'n' Grab": {
        program: [
          { op: 'chooseSlots', from: 'oppActive', min: 1, max: 1, as: 'old' },
          { op: 'switch', who: 'opp', chooser: 'opp' },
          { op: 'if', cond: { not: { inActive: { v: 'old' } } }, then: [{ op: 'damage', amount: 160, to: 'oppActive' }] },
        ],
      },
      // "Discard 2 Energy from this Pokémon."
      'Knuckle Sandwich': { post: [{ op: 'discardEnergy', from: 'self', count: 2 }] },
    },
  },
  {
    id: 'sv07-098',
    name: 'Jirachi',
    attacks: {
      // "Attach a Basic Energy card from your discard pile to 1 of your Benched Pokémon."
      'Swelling Wish': {
        program: [
          {
            op: 'if',
            cond: { gte: [{ pokemon: { zone: 'myBench' } }, 1] },
            then: [
              { op: 'chooseCards', from: 'discard', filter: { cat: 'energy', basicEnergy: true }, min: 1, max: 1, as: 'e', prompt: 'Choose a Basic Energy card' },
              { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 't', prompt: 'Attach it to which Benched Pokémon?' },
              { op: 'attach', cards: 'e', to: { v: 't' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv07-103',
    name: 'Meltan',
    attacks: {
      // "Search your deck for a Pokémon Tool card, reveal it, and put it into your hand. Then, shuffle your deck."
      'Knickknack Carrying': { program: searchToHand({ cat: 'trainer', ttype: 'tool' }, 1, { reveal: true }) },
    },
  },
  {
    id: 'sv07-104',
    name: 'Melmetal',
    attacks: {
      // "Before doing damage, discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing."
      'Reforged Axe': {
        program: [
          { op: 'custom', fn: 'c22.discardSelfTools', args: { as: 'n' } },
          { op: 'if', cond: { gte: [{ v: 'n' }, 1] }, then: [{ op: 'damage', amount: 250 }] },
        ],
      },
    },
  },
  {
    id: 'sv07-106',
    name: 'Duraludon',
    attacks: {
      // "This attack does 10 more damage for each damage counter on this Pokémon."
      'Raging Hammer': { damage: { add: [80, { mul: [10, { countersOn: 'self' }] }] } },
    },
  },
  {
    id: 'sv07-107',
    name: 'Archaludon',
    abilities: [
      {
        // "All of your Pokémon that have {M} Energy attached have no Retreat Cost."
        name: 'Metal Bridge',
        statics: [{ effect: { k: 'retreatCost', set: 0 }, scope: 'myPokemon', filter: { energy: { providesType: 'Metal' } } }],
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't attack."
      'Iron Blaster': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv07-112',
    name: 'Tauros',
    attacks: {
      // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
      'Destructive Horn': {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: HEADS, then: [{ op: 'discardEnergy', from: 'oppActive', count: 1 }] },
        ],
      },
    },
  },
  {
    id: 'sv07-115',
    name: 'Noctowl',
    notes: 'Compendium #2122: evolved onto a Pokémon whose damage is already over its HP, Noctowl is Knocked Out before Jewel Seeker can happen (the engine queues no evolve trigger for a Pokémon that is over its HP; the Knock Out follows).',
    abilities: [
      {
        // "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, if you have any Tera Pokémon in play, you may search your deck for up to 2 Trainer cards, reveal them, and put them into your hand. Then, shuffle your deck."
        // "Up to 2" on an Ability is 1 to 2 (TPCi 2026-02-19).
        // Ruling (TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2122/): a Pokémon whose damage is already over the
        //  evolved Pokémon's HP (the Basic's extra HP stops applying) is Knocked Out before Jewel Seeker could happen, so it is not offered.
        name: 'Jewel Seeker',
        triggers: [
          {
            on: 'evolveFromHand',
            oncePerTurn: true,
            optional: true,
            when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { tera: true } } }, 1] },
            program: searchToHand({ cat: 'trainer' }, 2, { reveal: true, min: 1 }),
          },
        ],
      },
    ],
  },
  {
    id: 'sv07-119',
    name: 'Bouffalant',
    abilities: [
      {
        // "As long as you have at least 1 other Bouffalant in play, all of your Basic {C} Pokémon take 60 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Curly Wall doesn't stack."
        name: 'Curly Wall',
        statics: [
          {
            effect: { k: 'damageIn', amount: -60, fromOpp: true, noStack: 'Curly Wall' },
            scope: 'myPokemon',
            filter: { stage: 'basic', type: 'Colorless' },
            // This Bouffalant plus at least 1 other one.
            when: { gte: [{ pokemon: { zone: 'myPokemon', filter: { name: 'Bouffalant' } } }, 2] },
          },
        ],
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't attack."
      'Boundless Power': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv07-120',
    name: 'Tornadus',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance)."
      'Storm Barrier': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -50 }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
];
