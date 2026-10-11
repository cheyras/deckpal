/**
 * Standard batch c21: Trainer and Pokémon of Paldean Fates (sv06.5) and Surging Sparks-era sv07 whose text no earlier
 * script covered. Each script is written from the printed text in frames; quotes below are that text.
 *
 * Not scripted (the vocabulary lacks the capability):
 *  - sv06.5-062 Poké Vital A: "This card can't be put into your hand or deck from the discard pile." No clause stops a
 *    specific card from being returned to the hand or deck from the discard pile by another card's effect.
 *  - sv07-044 Drednaw: Impervious Shell ("Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon if
 *    that damage is 200 or more") needs a damage-threshold prevention; `preventDamage` has no amount test.
 *  - sv07-049 Lanturn: Disorienting Flash ("Put 8 damage counters instead of 3 on that Pokémon for this Special Condition")
 *    needs a Confused Pokémon that puts a different number of counters on itself; the Confusion check is a fixed 3.
 *
 * Pokémon V: sv07-051 Galvantula ex's "Pokémon ex or Pokémon V" is scripted as ex only. The filter vocabulary has no V test
 * and no Pokémon V is legal in Standard 2026 (as in std-c14 sv05-056 and std-seed2 Iron Hands).
 */
import type { CardScript, Cond, Expr, Filter } from '../../dsl.js';
import { BENCH_SPACE } from './helpers.js';
import './std-c01-customs.js'; // c01.benchCards
import './std-c06-customs.js'; // c06.attachSplit
import './std-c21-customs.js';
import './std-seed1-customs.js'; // std.discardOppActiveTools, std.energyInPlay

const BASIC_G: Filter = { cat: 'energy', energyType: 'Grass' };
const BASIC_L: Filter = { cat: 'energy', energyType: 'Lightning' };

/** "Flip a coin. If heads, ..." */
const HEADS: Cond = { gte: [{ v: 'h' }, 1] };

/** 1 when the Defending Pokémon has this Special Condition, else 0. */
function has(cond: 'asleep' | 'confused' | 'paralyzed' | 'poisoned' | 'burned'): { cond: Cond; then: number; else: number } {
  return { cond: { slotIs: { ref: 'defender', filter: { condition: cond } } }, then: 1, else: 0 };
}

/** "Attacks used by this Pokémon cost {C} less for each Kofu card in your discard pile." (Crabominable, Veluza) */
const FOOD_PREP = {
  name: 'Food Prep',
  statics: [
    {
      effect: { k: 'attackCostC' as const, delta: { mul: [-1, { count: { zone: 'discard' as const, filter: { name: 'Kofu' } } }] } as Expr },
      scope: 'self' as const,
    },
  ],
};

export const STD_C21: CardScript[] = [
  {
    id: 'sv06.5-064',
    name: "Xerosic's Machinations",
    // "Your opponent discards cards from their hand until they have 3 cards in their hand."
    // A Trainer that would do nothing can't be played (TPCi 2014-11-13): the opponent needs more than 3 cards in hand.
    // Your opponent chooses which cards to discard.
    playable: { gte: [{ handSize: 'opp' }, 4] },
    play: [
      {
        op: 'chooseCards',
        from: 'hand',
        who: 'opp',
        chooser: 'opp',
        min: { max: [0, { sub: [{ handSize: 'opp' }, 3] }] },
        max: { max: [0, { sub: [{ handSize: 'opp' }, 3] }] },
        as: 'd',
        prompt: 'Discard cards from your hand until you have 3',
      },
      { op: 'move', cards: 'd', to: 'discard', who: 'opp' },
    ],
  },
  {
    id: 'sv07-003',
    name: 'Ledian',
    abilities: [
      {
        // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may switch in 1 of your opponent's Benched Pokémon that has 90 HP or less remaining to the Active Spot."
        // Offered only when the opponent has a Benched Pokémon with 90 HP or less remaining (HP minus damage).
        name: 'Glittering Star Pattern',
        triggers: [
          {
            on: 'evolveFromHand',
            optional: true,
            when: { custom: 'c21.oppBenchLowHp', args: { max: 90 } },
            program: [
              { op: 'custom', fn: 'c21.pickOppBenchLowHp', args: { max: 90, as: 't' } },
              { op: 'if', cond: { gte: [{ len: 't' }, 1] }, then: [{ op: 'switch', who: 'opp', chooser: 'self', with: { v: 't' } }] },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon."
      Swift: { ignore: { weakness: true, resistance: true, defenderEffects: true } },
    },
  },
  {
    id: 'sv07-006',
    name: 'Cradily',
    abilities: [
      {
        // "Once during your turn, you may flip a coin. If heads, choose Burned, Confused, or Poisoned. Your opponent's Active Pokémon is now affected by that Special Condition."
        // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2014/): Cannot use if opponent's Active is already Burned, Confused, and Poisoned.
        // -- not usable while the Defending Pokémon is already Burned, Confused and Poisoned.
        name: 'Selective Slime',
        activated: {
          when: {
            not: {
              and: (['burned', 'confused', 'poisoned'] as const).map((c) => ({ slotIs: { ref: 'oppActive' as const, filter: { condition: c } } })),
            },
          },
          program: [
            { op: 'flip', n: 1, as: 'h' },
            {
              op: 'if',
              cond: HEADS,
              then: [
                { op: 'chooseOption', options: ['Burned', 'Confused', 'Poisoned'], as: 'k', prompt: 'Choose a Special Condition' },
                { op: 'if', cond: { eq: [{ v: 'k' }, 0] }, then: [{ op: 'condition', cond: 'burned', to: 'oppActive' }] },
                { op: 'if', cond: { eq: [{ v: 'k' }, 1] }, then: [{ op: 'condition', cond: 'confused', to: 'oppActive' }] },
                { op: 'if', cond: { eq: [{ v: 'k' }, 2] }, then: [{ op: 'condition', cond: 'poisoned', to: 'oppActive' }] },
              ],
            },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon."
      'Miasma Wind': {
        damage: { mul: [100, { add: [has('asleep'), has('confused'), has('paralyzed'), has('poisoned'), has('burned')] }] },
      },
    },
  },
  {
    id: 'sv07-007',
    name: 'Carnivine',
    attacks: {
      // "Heal 40 damage from this Pokémon."
      Nosh: { program: [{ op: 'heal', amount: 40, to: 'self' }] },
      // "This attack does 10 less damage for each damage counter on this Pokémon."
      'Loom Over': { damage: { sub: [130, { mul: [10, { countersOn: 'self' }] }] } },
    },
  },
  {
    id: 'sv07-008',
    name: 'Mow Rotom',
    attacks: {
      // "Before doing damage, discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon."
      'Reaping Dash': {
        pre: [
          { op: 'custom', fn: 'std.discardOppActiveTools' },
          { op: 'discardEnergy', from: 'oppActive', count: 'all', filter: { basicEnergy: false } },
        ],
      },
    },
  },
  {
    id: 'sv07-011',
    name: 'Eldegoss',
    attacks: {
      // "Put this Pokémon and all attached cards into your deck. If you do, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck."
      // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2018/): Can search even if deck was empty before putting Eldegoss into it.
      // -- the Pokémon goes into the deck first, so an empty deck can still be searched (it holds Eldegoss and its cards).
      'Breezy Gift': {
        program: [
          { op: 'custom', fn: 'c21.selfIntoDeck', args: { as: 'done' } },
          {
            op: 'if',
            cond: { eq: [{ v: 'done' }, 1] },
            then: [
              { op: 'chooseCards', from: 'deck', min: 0, max: 3, as: 'found', prompt: 'Search your deck for up to 3 cards' },
              { op: 'move', cards: 'found', to: 'hand' },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'sv07-013',
    name: 'Dipplin',
    attacks: {
      // "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon."
      'Coated Attack': {
        post: [{ op: 'effect', static: { k: 'preventDamage', attacker: { stage: 'basic' } }, on: 'self', duration: 'oppNextTurn' }],
      },
    },
  },
  {
    id: 'sv07-014',
    name: 'Hydrapple ex',
    abilities: [
      {
        // "Once during your turn, you may attach a Basic {G} Energy card from your hand to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, heal 30 damage from that Pokémon."
        name: 'Ripening Charge',
        activated: {
          when: { gte: [{ count: { zone: 'hand', filter: BASIC_G } }, 1] },
          program: [
            { op: 'chooseCards', from: 'hand', filter: BASIC_G, min: 1, max: 1, as: 'e', prompt: 'Attach a Basic Grass Energy card from your hand' },
            { op: 'chooseSlots', from: 'myPokemon', min: 1, max: 1, as: 't', prompt: 'Attach it to which of your Pokémon?' },
            { op: 'set', v: 'before', value: { count: { zone: 'hand', filter: BASIC_G } } },
            { op: 'attach', cards: 'e', to: { v: 't' } },
            { op: 'if', cond: { lt: [{ count: { zone: 'hand', filter: BASIC_G } }, { v: 'before' }] }, then: [{ op: 'heal', amount: 30, to: { v: 't' } }] },
          ],
        },
      },
    ],
    attacks: {
      // "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon."
      'Syrup Storm': {
        pre: [{ op: 'custom', fn: 'std.energyInPlay', args: { type: 'Grass', as: 'n' } }],
        damage: { add: [30, { mul: [30, { v: 'n' }] }] },
      },
    },
  },
  {
    id: 'sv07-025',
    name: 'Turtonator',
    attacks: {
      // "Your opponent's Active Pokémon is now Burned. During your opponent's next turn, that Pokémon can't retreat."
      'Ring of Fire': {
        post: [
          { op: 'condition', cond: 'burned', to: 'defender' },
          { op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' },
        ],
      },
      // "This Pokémon also does 60 damage to itself."
      'Inferno Onrush': { post: [{ op: 'damage', amount: 60, to: 'self' }] },
    },
  },
  {
    id: 'sv07-032',
    name: 'Lapras ex',
    attacks: {
      // "This attack does 40 damage for each Energy attached to this Pokémon."
      'Power Splash': { damage: { mul: [40, { energyOn: 'self' }] } },
      // "Look at the top 20 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck."
      'Larimar Rain': {
        program: [
          { op: 'custom', fn: 'c21.lookTopAny', args: { n: 20, filter: { cat: 'energy' }, as: 'e' } },
          { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'e', zone: 'myPokemon' } },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv07-038',
    name: 'Carracosta',
    abilities: [
      {
        // "Attacks used by your Pokémon do 30 more damage to your opponent's Active Evolution Pokémon (before applying Weakness and Resistance)."
        name: 'Primal Knowledge',
        statics: [{ effect: { k: 'damageOut', amount: 30, vs: { stage: 'evolution' } }, scope: 'myPokemon' }],
      },
    ],
  },
  {
    id: 'sv07-041',
    name: 'Greninja ex',
    attacks: {
      // "Flip a coin. If heads, this attack does 100 more damage."
      'Shifting Shuriken': {
        pre: [{ op: 'flip', n: 1, as: 'h' }],
        damage: { add: [100, { cond: HEADS, then: 100, else: 0 }] },
      },
    },
  },
  {
    id: 'sv07-042',
    name: 'Crabominable',
    abilities: [FOOD_PREP],
    attacks: {
      // "During your next turn, this Pokémon can't use Haymaker."
      Haymaker: { post: [{ op: 'effect', static: { k: 'cantUseAttack', attack: 'Haymaker' }, on: 'self', duration: 'myNextTurn' }] },
    },
  },
  {
    id: 'sv07-045',
    name: 'Veluza',
    abilities: [FOOD_PREP],
    attacks: {
      // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
      'Sonic Edge': { ignore: { defenderEffects: true } },
    },
  },
  {
    id: 'sv07-047',
    name: 'Electivire',
    attacks: {
      // "During your next turn, your Pokémon can't attack. (This includes new Pokémon that come into play.)"
      'Unleash Lightning': {
        post: [{ op: 'effect', static: { k: 'cantAttack' }, onPlayer: 'self', scope: 'myPokemon', duration: 'myNextTurn' }],
      },
    },
  },
  {
    id: 'sv07-050',
    name: 'Joltik',
    attacks: {
      // "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck."
      'Jolting Charge': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: BASIC_G, min: 0, max: 2, as: 'g', prompt: 'Choose up to 2 Basic Grass Energy cards' },
          { op: 'chooseCards', from: 'deck', filter: BASIC_L, min: 0, max: 2, as: 'l', prompt: 'Choose up to 2 Basic Lightning Energy cards' },
          { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'g', zone: 'myPokemon' } },
          { op: 'custom', fn: 'c06.attachSplit', args: { cards: 'l', zone: 'myPokemon' } },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv07-051',
    name: 'Galvantula ex',
    attacks: {
      // "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 110 more damage."
      'Charged Web': { damage: { add: [110, { cond: { slotIs: { ref: 'defender', filter: { ex: true } } }, then: 110, else: 0 }] } },
      // "Discard all Energy from this Pokémon. During your opponent's next turn, they can't play any Item cards from their hand."
      Fulgurite: {
        post: [
          { op: 'discardEnergy', from: 'self', count: 'all' },
          { op: 'effect', static: { k: 'itemLock' }, onPlayer: 'opp', duration: 'oppNextTurn' },
        ],
      },
    },
    notes: 'Pokémon V cards have rotated out of Standard and the filter vocabulary has no V test; only the ex half of the condition is expressible.',
  },
  {
    id: 'sv07-052',
    name: 'Charjabug',
    attacks: {
      // "Search your deck for up to 3 Charjabug and put them onto your Bench. Then, shuffle your deck."
      // Charjabug is a Stage 1: it goes onto the Bench as it is (c01.benchCards), as far as the Bench has room.
      'Parallel Placement': {
        program: [
          { op: 'chooseCards', from: 'deck', filter: { name: 'Charjabug' }, min: 0, max: { min: [3, BENCH_SPACE] }, as: 'found' },
          { op: 'custom', fn: 'c01.benchCards', args: { cards: 'found' } },
          { op: 'shuffle' },
        ],
      },
    },
  },
  {
    id: 'sv07-054',
    name: 'Togedemaru',
    attacks: {
      // "If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed."
      'Electrifying Chance': {
        post: [{ op: 'if', cond: { eq: [{ prizesLeft: 'self' }, 1] }, then: [{ op: 'condition', cond: 'paralyzed', to: 'defender' }] }],
      },
    },
  },
  {
    id: 'sv07-055',
    name: 'Zeraora',
    attacks: {
      // "This attack does 20 more damage for each of your opponent's Benched Pokémon."
      'Combat Thunder': { damage: { add: [20, { mul: [20, { pokemon: { zone: 'oppBench' } }] }] } },
    },
  },
  {
    id: 'sv07-057',
    name: 'Slowpoke',
    attacks: {
      // "Put a Pokémon from your discard pile into your hand."
      'Dangle Tail': {
        program: [
          { op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon' }, min: 1, max: 1, as: 'x', prompt: 'Put a Pokémon from your discard pile into your hand' },
          { op: 'move', cards: 'x', to: 'hand' },
        ],
      },
    },
  },
  {
    id: 'sv07-060',
    name: 'Drifloon',
    attacks: {
      // "During your opponent's next turn, this Pokémon takes 10 less damage from attacks (after applying Weakness and Resistance)."
      Expand: { post: [{ op: 'effect', static: { k: 'damageIn', amount: -10 }, on: 'self', duration: 'oppNextTurn' }] },
    },
  },
];
