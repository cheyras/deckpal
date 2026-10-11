/**
 * Standard batch c36: Black Bolt (sv10.5b) and White Flare (sv10.5w) cards that no other lane scripted. Written from the printed
 * text in frames.ts; quotes below are that text. Tests: src/__tests__/cards-std-c36.test.ts.
 *
 * Rulings in the compendium that name a card here but are about another card's text (not applied): Crustle #2335 / #1902
 * (Mysterious Rock Inn, Crag Bash), Cinccino #170-172 / #338 / #1160 / #248 (Make Do, Amazing Plea, Smooth Coat), Sandile #158
 * (Intimidating Fang), Krookodile #2245 / #548, Klang #2185 (Emergency Rotation), Bisharp #111, Cobalion #1784 / #1015,
 * Haxorus #2033 / #453, Pidove #1949 / #484, Leavanny #538, Throh #369, Conkeldurr #368, Fennel #2198 (Maractus' Lively Needles).
 */
import type { AbilityScript, CardScript, Cond, Expr, Filter, Program, StaticDef } from '../../dsl.js';
import { damageOneOf } from './helpers.js';
import './std-c36-customs.js'; // c36.benchEnergyToActive
import './std-c11-customs.js'; // c11.retreatCostOf
import './std-c27-customs.js'; // c27.healEach
import './std-seed1-customs.js'; // std.revealHand
import './std-seed2-customs.js'; // seed2.healEach

/** "If your opponent's Active Pokémon is Poisoned" */
const OPP_POISONED: Cond = { slotIs: { ref: 'defender', filter: { condition: 'poisoned' } } };

/**
 * "This Pokémon gets +40 HP for each {F} Energy attached to it." One static per count (the HP delta of a static is a fixed
 * number), each adding 40 once there are at least n {F} Energy. Ten covers any realistic number of Energy.
 */
const CRAFTSMANSHIP: AbilityScript = {
  name: 'Craftsmanship',
  statics: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
    (n): StaticDef => ({ effect: { k: 'hp', delta: 40 }, scope: 'self', when: { gte: [{ energyOn: 'self', type: 'Fighting' }, n] } }),
  ),
};

/** "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Poisoned." */
const POISON_POINT: AbilityScript = {
  name: 'Poison Point',
  // The trigger is queued when the damage lands, so it still resolves when that damage Knocks this Pokémon Out.
  // The Attacking Pokémon is the opponent's Active Pokémon.
  triggers: [{ on: 'damagedByAttackActive', program: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }] }],
};

/** Your opponent discards n cards from their hand (they choose which). */
const OPP_DISCARDS = (n: number): Program => [
  { op: 'chooseCards', from: 'hand', who: 'opp', chooser: 'opp', min: n, max: n, as: 'd', prompt: `Discard ${n === 1 ? 'a card' : `${n} cards`} from your hand` },
  { op: 'move', cards: 'd', to: 'discard', who: 'opp' },
];

/** "Flip a coin. If heads, this attack does N more damage." as the damage expression (the flip is in `pre`). */
const COIN_BONUS = (base: number, bonus: number): Expr => ({ add: [base, { mul: [bonus, { v: 'h' }] }] });

/** "During your opponent's next turn, this Pokémon takes N less damage from attacks (after applying Weakness and Resistance)." */
const HARD_GEARS = (n: number): CardScript['attacks'] => ({
  'Hard Gears': { post: [{ op: 'effect', static: { k: 'damageIn', amount: -n }, on: 'self', duration: 'oppNextTurn' }] },
});

const BASIC_POKEMON: Filter = { cat: 'pokemon', stage: 'basic' };

export const STD_C36: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv10.5b-046',
    name: 'Excadrill ex',
    attacks: {
      // "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // No damaged Benched Pokémon: only the Defending Pokémon is hit.
      'Piercing Drill': { post: damageOneOf('oppBench', 60, { damaged: true }) },
      // "This attack's damage isn't affected by Resistance."
      'Rock Tumble': { ignore: { resistance: true } },
    },
  },
  {
    id: 'sv10.5b-048',
    name: 'Gurdurr',
    attacks: {
      // "Discard the top card of your opponent's deck."
      'Hammer Arm': { post: [{ op: 'move', cards: { top: 1, who: 'opp' }, to: 'discard', who: 'opp' }] },
    },
  },
  {
    id: 'sv10.5b-049',
    name: 'Conkeldurr',
    abilities: [CRAFTSMANSHIP],
    attacks: {
      // "Flip 2 coins. This attack does 50 more damage for each heads."
      'Swing Around': { pre: [{ op: 'flip', n: 2, as: 'h' }], damage: COIN_BONUS(100, 50) },
    },
    notes:
      'Ability: the HP is +40 per {F} Energy provided (units of {F}), so an Energy card that provides every type counts once, and Prism Energy counts only on a Basic Pokémon. ' +
      'Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2180/): Prism Energy attached to Conkeldurr gives no HP, since Conkeldurr is not a Basic Pokemon. ' +
      'Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2179/): Luminous Energy alone among Special Energy gives +40 HP (it provides every type; pinned with Legacy Energy, which provides every type too). ' +
      'The HP is written for up to 10 {F} Energy.',
  },
  {
    id: 'sv10.5b-050',
    name: 'Throh',
    attacks: {
      // "This attack does 30 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2203/): with Air Balloon the Retreat Cost is {C} (printed {C}{C}{C}), so Shoulder Throw does only 30 less.
      // -- the Retreat Cost the Defending Pokémon has right now.
      'Shoulder Throw': {
        pre: [{ op: 'custom', fn: 'c11.retreatCostOf', args: { as: 'n' } }],
        damage: { sub: [120, { mul: [30, { v: 'n' }] }] },
      },
    },
  },
  {
    id: 'sv10.5b-052',
    name: 'Crustle',
    abilities: [
      // "If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10."
      { name: 'Sturdy', statics: [{ effect: { k: 'surviveKoAtFullHp' }, scope: 'self' }] },
    ],
    attacks: {
      // "Flip a coin. If heads, this attack does 60 more damage."
      'Stone Edge': { pre: [{ op: 'flip', n: 1, as: 'h' }], damage: COIN_BONUS(80, 60) },
    },
  },
  {
    id: 'sv10.5b-053',
    name: 'Landorus',
    attacks: {
      // "Attach a Basic {F} Energy card from your discard pile to this Pokémon."
      'Abundant Harvest': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { energyType: 'Fighting' }, min: 1, max: 1, as: 'e', prompt: 'Choose a Basic {F} Energy card' },
          { op: 'attach', cards: 'e', to: 'self' },
        ],
      },
      // "This attack also does 10 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2190/): Tera Pokémon on the Bench are protected from all attack damage regardless of who uses the attack.
      Earthquake: { post: [{ op: 'damage', amount: 10, to: { each: 'myBench' } }] },
    },
  },
  {
    id: 'sv10.5b-055',
    name: 'Whirlipede',
    attacks: {
      // "If your opponent's Active Pokémon is Poisoned, this attack does 60 more damage."
      Venoshock: { damage: { add: [30, { cond: OPP_POISONED, then: 60, else: 0 }] } },
    },
  },
  {
    id: 'sv10.5b-056',
    name: 'Scolipede',
    abilities: [POISON_POINT],
    attacks: {
      // "If your opponent's Active Pokémon is Poisoned, this attack does 90 more damage."
      Venoshock: { damage: { add: [90, { cond: OPP_POISONED, then: 90, else: 0 }] } },
    },
  },
  {
    id: 'sv10.5b-057',
    name: 'Sandile',
    attacks: {
      // "Your opponent discards a card from their hand."  (They choose it.)
      'Tighten Up': { post: OPP_DISCARDS(1) },
    },
  },
  {
    id: 'sv10.5b-058',
    name: 'Krokorok',
    attacks: {
      // "Your opponent discards 2 cards from their hand."  (They choose them.)
      'Tighten Up': { post: OPP_DISCARDS(2) },
    },
  },
  {
    id: 'sv10.5b-059',
    name: 'Krookodile',
    attacks: {
      // "Your opponent discards 2 cards from their hand."  (They choose them.)
      'Tighten Up': { post: OPP_DISCARDS(2) },
      // "If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage."
      'Cursed Slug': { damage: { add: [120, { cond: { lte: [{ handSize: 'opp' }, 3] }, then: 120, else: 0 }] } },
    },
  },
  {
    id: 'sv10.5b-061',
    name: 'Klink',
    // "During your opponent's next turn, this Pokémon takes 10 less damage from attacks (after applying Weakness and Resistance)."
    attacks: HARD_GEARS(10),
  },
  {
    id: 'sv10.5b-062',
    name: 'Klang',
    // "During your opponent's next turn, this Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance)."
    attacks: HARD_GEARS(20),
  },
  {
    id: 'sv10.5b-063',
    name: 'Klinklang',
    abilities: [
      {
        // "All of your Pokémon that have any {M} Energy attached take 20 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance)."
        // "{M} Energy" is any Energy card providing {M}, Basic or Special.
        name: 'Gear Coating',
        statics: [{ effect: { k: 'damageIn', amount: -20, fromOpp: true }, scope: 'myPokemon', filter: { energy: { providesType: 'Metal' } } }],
      },
    ],
  },
  {
    id: 'sv10.5b-065',
    name: 'Bisharp',
    attacks: {
      // "If your opponent's Active Pokémon already has any damage counters on it, this attack does 60 more damage."
      'Finishing Blow': { damage: { add: [60, { cond: { slotIs: { ref: 'defender', filter: { damaged: true } } }, then: 60, else: 0 }] } },
    },
  },
  {
    id: 'sv10.5b-066',
    name: 'Cobalion',
    attacks: {
      // "Discard a Special Energy from your opponent's Active Pokémon."
      'Righteous Edge': { post: [{ op: 'discardEnergy', from: 'defender', count: 1, filter: { basicEnergy: false } }] },
      // "If this Pokémon has a Pokémon Tool attached, this attack does 40 more damage."
      'Metal Arms': { damage: { add: [80, { cond: { slotIs: { ref: 'self', filter: { tool: true } } }, then: 40, else: 0 }] } },
    },
  },
  {
    id: 'sv10.5b-070',
    name: 'Haxorus',
    attacks: {
      // "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 80 more damage."
      'Cross-Cut': { damage: { add: [80, { cond: { slotIs: { ref: 'defender', filter: { stage: 'evolution' } } }, then: 80, else: 0 }] } },
      // "If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."
      'Axe Blast': {
        program: [{ op: 'if', cond: { slotIs: { ref: 'oppActive', filter: { stage: 'basic' } } }, then: [{ op: 'knockOut', target: 'oppActive' }] }],
      },
    },
  },
  {
    id: 'sv10.5b-071',
    name: 'Pidove',
    attacks: {
      // "Your opponent reveals their hand."
      Scout: { program: [{ op: 'custom', fn: 'std.revealHand', args: { who: 'opp' } }] },
    },
  },
  {
    id: 'sv10.5b-072',
    name: 'Tranquill',
    attacks: {
      // "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon."
      Fly: {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { lt: [{ v: 'h' }, 1] }, then: [{ op: 'end' }] },
          { op: 'damage', amount: 40 },
          { op: 'effect', static: { k: 'preventDamage', andEffects: true }, on: 'self', duration: 'oppNextTurn' },
        ],
      },
    },
  },
  {
    id: 'sv10.5b-076',
    name: 'Cinccino',
    attacks: {
      // "This attack does 20 more damage for each of your Benched Pokémon."
      'Do the Wave': { damage: { add: [20, { mul: [20, { pokemon: { zone: 'myBench' } }] }] } },
    },
    notes: 'The compendium rulings listed under Cinccino (#170-172, #338, #1160, #248) are about the Abilities and attacks of other Cinccino cards (Make Do, Amazing Plea, Smooth Coat); this card has none of them.',
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv10.5b-081',
    name: 'Energy Coin',
    // "Flip 2 coins. If both of them are heads, search your deck for a Basic Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck."
    // Flipping is an effect, so the card is playable whatever the deck holds.
    play: [
      { op: 'flip', n: 2, as: 'h' },
      {
        op: 'if',
        cond: { gte: [{ v: 'h' }, 2] },
        then: [
          { op: 'chooseCards', from: 'deck', filter: { basicEnergy: true }, min: 0, max: 1, as: 'e', prompt: 'Search your deck for a Basic Energy card' },
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
    ],
  },
  {
    id: 'sv10.5b-082',
    name: 'Fennel',
    // "Heal 40 damage from each of your Pokémon."
    // No damage to heal, no effect, no play.
    playable: { gte: [{ pokemon: { zone: 'myPokemon', filter: { damaged: true } } }, 1] },
    play: [{ op: 'custom', fn: 'seed2.healEach', args: { amount: 40, zone: 'myPokemon' } }],
  },
  {
    id: 'sv10.5b-083',
    name: "N's Plan",
    // "Move up to 2 Energy from your Benched Pokémon to your Active Pokémon."
    // "Up to 2" of a Trainer is 1 to 2 (TPCi 2026-02-19); no Energy on the Bench, no effect, no play.
    // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2205/): Energy cards that provide more than one Energy each can be moved
    // (two Double Turbo Energy, for example): the limit counts Energy cards.
    playable: { gte: [{ pokemon: { zone: 'myBench', filter: { energized: true } } }, 1] },
    play: [{ op: 'custom', fn: 'c36.benchEnergyToActive', args: { max: 2 } }],
  },

  // ---------------------------------------------------------------- Pokémon (White Flare)
  {
    id: 'sv10.5w-002',
    name: 'Swadloon',
    abilities: [
      {
        // "Once during your turn, you may heal 20 damage from your Active Pokémon."
        // Usable only while your Active Pokémon has damage on it (a use that heals nothing does nothing).
        name: 'Healing Leaves',
        activated: {
          when: { slotIs: { ref: 'myActive', filter: { damaged: true } } },
          program: [{ op: 'heal', amount: 20, to: 'myActive' }],
        },
      },
    ],
  },
  {
    id: 'sv10.5w-003',
    name: 'Leavanny',
    attacks: {
      // "Heal 100 damage from each of your Basic Pokémon."
      'Healing Wrapping': { program: [{ op: 'custom', fn: 'c27.healEach', args: { amount: 100, zone: 'myPokemon', filter: BASIC_POKEMON } }] },
      // "Flip a coin. If heads, this attack does 40 more damage."
      'X-Scissor': { pre: [{ op: 'flip', n: 1, as: 'h' }], damage: COIN_BONUS(90, 40) },
    },
  },
];
