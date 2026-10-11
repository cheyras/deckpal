/**
 * Standard batch c13: Scarlet & Violet Grass, Fire and Water Pokémon (sv05 and a promo).
 *
 * Skipped, with the missing capability:
 *  - mep-086 Slowpoke, Dopey Face ("This Pokémon can't be Confused."): no static stops a Special Condition from being applied.
 *  - sv05-029 Magcargo, Lava Zone ("Whenever your opponent's Active Pokémon moves to the Bench during their turn, their new
 *    Active Pokémon is now Burned."): no trigger for a Pokémon moving from the Active Spot to the Bench.
 *
 * Pokémon V: sv05-013 Shaymin's "Benched Pokémon ex or Benched Pokémon V" is scripted as ex only. The filter vocabulary has no
 * V test and no Pokémon V is legal in Standard 2026 (no V frame in the snapshot), as in std-seed2 Iron Hands.
 */
import type { CardScript, Cond, Filter } from '../../dsl.js';
import { searchToBench, searchToHand } from './helpers.js';
import './std-c13-customs.js';
import './std-seed2-customs.js'; // seed2.energyToHand
import './std-seed1-customs.js'; // std.discardRandomFromHand

const GRASS: Filter = { type: 'Grass' };
const OPP_BURNED: Cond = { slotIs: { ref: 'oppActive', filter: { condition: 'burned' } } };

/** "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Poisoned." */
const POISON_POINT = {
  name: 'Poison Point',
  // The trigger is queued when the damage lands, so it still resolves when that damage Knocks this Pokémon Out.
  // The Attacking Pokémon is the opponent's Active Pokémon.
  triggers: [{ on: 'damagedByAttackActive' as const, program: [{ op: 'condition' as const, cond: 'poisoned' as const, to: 'oppActive' as const }] }],
};

/** "This Pokémon gets +50 HP for each Prize card your opponent has taken." One static per count (the vocabulary's HP delta is a fixed number). */
const RESILIENT_SOUL = {
  name: 'Resilient Soul',
  statics: [1, 2, 3, 4, 5, 6].map((n) => ({
    effect: { k: 'hp' as const, delta: 50 * n },
    scope: 'self' as const,
    when: { eq: [{ prizesTaken: 'opp' as const }, n] } as Cond,
  })),
};

export const STD_C13: CardScript[] = [
  {
    id: 'sv05-005',
    name: 'Shiftry',
    attacks: {
      // "Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."
      // With 3 or fewer Benched Pokémon all of them are chosen and none is left to shuffle.
      // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/1954/): effects preventing damage also prevent the Benched Pokémon from being shuffled.
      'Expelling Tornado': {
        program: [
          { op: 'chooseSlots', from: 'oppBench', min: 3, max: 3, as: 'k', prompt: "Choose 3 of your opponent's Benched Pokémon" },
          { op: 'custom', fn: 'c13.shuffleBenchExcept', args: { keep: 'k' } },
        ],
      },
      // "Put an Energy attached to this Pokémon into your hand."
      'Energy Loop': { post: [{ op: 'custom', fn: 'seed2.energyToHand' }] },
    },
    notes: 'Compendium #1954 (Rabsca\'s Spherical Shield protects the Benched Pokémon that were not chosen) is applied by shuffling only those Benched Pokémon the attack\'s effects are not prevented on.',
  },
  {
    id: 'sv05-008',
    name: 'Roselia',
    abilities: [POISON_POINT],
  },
  {
    id: 'sv05-009',
    name: 'Roserade',
    abilities: [POISON_POINT],
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      'Bind Down': { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv05-010',
    name: 'Turtwig',
    abilities: [
      {
        // "This Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance)."
        name: 'Solid Shell',
        statics: [{ effect: { k: 'damageIn', amount: -20 }, scope: 'self' }],
      },
    ],
  },
  {
    id: 'sv05-011',
    name: 'Grotle',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance)."
      'Ramming Shell': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -20 }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
  {
    id: 'sv05-012',
    name: 'Torterra ex',
    attacks: {
      // "This attack does 30 damage for each of your {G} Pokémon in play."
      'Forest March': { damage: { mul: [30, { pokemon: { zone: 'myPokemon', filter: GRASS } }] } },
      // "Heal 50 damage from this Pokémon."
      'Jungle Hammer': { post: [{ op: 'heal', amount: 50, to: 'self' }] },
    },
  },
  {
    id: 'sv05-013',
    name: 'Shaymin',
    attacks: {
      // "This attack does 60 damage to 1 of your opponent's Benched Pokémon ex or Benched Pokémon V. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Pinpoint Dive': {
        program: [
          { op: 'chooseSlots', from: 'oppBench', filter: { ex: true }, min: 1, max: 1, as: 't', prompt: "Choose 1 of your opponent's Benched Pokémon ex" },
          { op: 'damage', amount: 60, to: { v: 't' } },
        ],
      },
    },
    notes: 'Pokémon V cards have rotated out of Standard and the filter vocabulary has no V test; only the ex half of the target is expressible.',
  },
  {
    id: 'sv05-015',
    name: 'Whimsicott',
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may heal all damage from your Active {G} Pokémon. If you healed any damage in this way, discard all Energy from that Pokémon."
        // Offered only when the Active Pokémon is a {G} Pokémon with damage on it (there is nothing to heal otherwise, so nothing is discarded).
        name: 'Wafting Heal',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            when: { slotIs: { ref: 'myActive', filter: { type: 'Grass', damaged: true } } },
            program: [
              { op: 'heal', amount: { mul: [10, { countersOn: 'myActive' }] }, to: 'myActive', as: 'healed' },
              { op: 'if', cond: { gte: [{ v: 'healed' }, 1] }, then: [{ op: 'discardEnergy', from: 'myActive', count: 'all' }] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'sv05-017',
    name: 'Sawsbuck',
    abilities: [
      {
        // "Once during your turn, you may search your deck for a Stadium card, reveal it, and put it into your hand. Then, shuffle your deck."
        name: 'Changing Seasons',
        activated: { program: searchToHand({ ttype: 'stadium' }, 1, { reveal: true }) },
      },
    ],
  },
  {
    id: 'sv05-018',
    name: 'Grubbin',
    attacks: {
      // "Search your deck for up to 2 Grubbin and put them onto your Bench. Then, shuffle your deck."
      Flock: { post: searchToBench({ name: 'Grubbin' }, 2) },
    },
  },
  {
    id: 'sv05-021',
    name: 'Brambleghast',
    abilities: [RESILIENT_SOUL],
    attacks: {
      // "Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads."
      'Powerful Needles': {
        pre: [{ op: 'flip', n: { energyOn: 'self' }, as: 'h' }],
        damage: { mul: [80, { v: 'h' }] },
      },
    },
  },
  {
    id: 'sv05-025',
    name: 'Iron Leaves ex',
    abilities: [
      {
        // "When you play this Pokémon from your hand onto your Bench during your turn, you may switch it with your Active Pokémon. If you do, you may move any amount of Energy from your other Pokémon to this Pokémon."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1952/): the Ability completes all its actions before Abilities stop working.
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1991/): an effect blocking Bench Abilities also prevents the trigger from queuing.
        name: 'Rapid Vernier',
        triggers: [
          {
            on: 'playToBench',
            optional: true,
            program: [
              { op: 'switch', who: 'self', with: 'self' },
              { op: 'custom', fn: 'c13.moveAnyEnergyToSelf' },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't attack."
      'Prism Edge': { post: [{ op: 'effect', static: { k: 'cantAttack' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv05-026',
    name: 'Ponyta',
    attacks: {
      // "Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck."
      'Charge Energy': { post: searchToHand({ basicEnergy: true }, 1, { reveal: true }) },
    },
  },
  {
    id: 'sv05-028',
    name: 'Slugma',
    attacks: {
      // "If your opponent's Active Pokémon is Burned, this attack does 40 more damage."
      'Roasting Heat': { damage: { add: [10, { cond: OPP_BURNED, then: 40, else: 0 }] } },
    },
  },
  {
    id: 'sv05-031',
    name: 'Heatmor',
    attacks: {
      // "Flip 3 coins. For each tails, discard an Energy from this Pokémon."
      'Licking Flames': {
        post: [
          { op: 'flip', n: 3, as: 'h' },
          // (No tails, no discard: the guard keeps a 0-card choice from being asked.)
          { op: 'if', cond: { lt: [{ v: 'h' }, 3] }, then: [{ op: 'discardEnergy', from: 'self', count: { sub: [3, { v: 'h' }] } }] },
        ],
      },
    },
  },
  {
    id: 'sv05-033',
    name: 'Torracat',
    attacks: {
      // "During your next turn, this Pokémon can't use Flare Strike."
      'Flare Strike': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Flare Strike' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv05-034',
    name: 'Incineroar ex',
    abilities: [
      {
        // "Attacks used by this Pokémon cost {C} less for each of your opponent's Benched Pokémon."
        name: 'Hustle Play',
        statics: [{ effect: { k: 'attackCostC', delta: { mul: [-1, { pokemon: { zone: 'oppBench' } }] } }, scope: 'self' }],
      },
    ],
    attacks: {
      // "Your opponent's Active Pokémon is now Burned."
      'Blaze Blast': { post: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
    },
  },
  {
    id: 'sv05-037',
    name: 'Centiskorch',
    attacks: {
      // "Your opponent's Active Pokémon is now Burned."
      Singe: { post: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
      // "If your opponent's Active Pokémon isn't Burned, this attack does nothing."
      'Charring Breath': { program: [{ op: 'if', cond: OPP_BURNED, then: [{ op: 'damage', amount: 180 }] }] },
    },
  },
  {
    id: 'sv05-038',
    name: 'Gouging Fire ex',
    attacks: {
      // "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot."
      'Blaze Blitz': { post: [{ op: 'custom', fn: 'c13.lockAttackUntilLeavesActive', args: { attack: 'Blaze Blitz' } }] },
    },
  },
  {
    id: 'sv05-041',
    name: 'Feraligatr',
    abilities: [
      {
        // "Once during your turn, you may put 5 damage counters on this Pokémon. If you do, during this turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/1953/): an effect applied before an Ability is disabled stays until the end of turn.
        name: 'Torrential Heart',
        activated: {
          program: [
            { op: 'counters', n: 5, to: 'self' },
            { op: 'effect', static: { k: 'damageOut', amount: 120 }, on: 'self', duration: 'thisTurn' },
          ],
        },
      },
    ],
    attacks: {
      // "During your next turn, this Pokémon can't use Giant Wave."
      'Giant Wave': { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Giant Wave' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv05-043',
    name: 'Sharpedo',
    attacks: {
      // "Flip 3 coins. For each heads, discard a random card from your opponent's hand."
      'Chew Off': {
        post: [
          { op: 'flip', n: 3, as: 'h' },
          { op: 'repeat', n: { v: 'h' }, body: [{ op: 'custom', fn: 'std.discardRandomFromHand', args: { who: 'opp' } }] },
        ],
      },
    },
  },
  {
    id: 'sv05-047',
    name: 'Wiglett',
    attacks: {
      // "Search your deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck."
      'Lucky Find': { post: searchToHand({ ttype: 'item' }, 1, { reveal: true }) },
      // "This Pokémon also does 20 damage to itself."
      'Aqua Bomb': { post: [{ op: 'damage', amount: 20, to: 'self' }] },
    },
  },
  {
    id: 'sv05-049',
    name: 'Palafin',
    attacks: {
      // "This Pokémon also does 10 damage to itself for each damage counter on it."
      'Vanguard Punch': { post: [{ op: 'damage', amount: { mul: [10, { countersOn: 'self' }] }, to: 'self' }] },
      // "Flip 2 coins. This attack does 90 damage for each heads."
      'Double Hit': {
        pre: [{ op: 'flip', n: 2, as: 'h' }],
        damage: { mul: [90, { v: 'h' }] },
      },
    },
  },
];
